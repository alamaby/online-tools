// Instagram public-post extractor (no login).
// Opens the post in a real headless browser, reads the caption and
// downloads every carousel slide / image at the best resolution served.
// Usage:
//   node extract.mjs --url <instagram post url> --job <job-id> --out <dir>
//
// Output in <out>/:
//   result.json   - post metadata, caption, slide list (see README)
//   slide-01.jpg  - one file per slide (extension follows the real type)
//   slide-01.mp4  - for video slides, plus slide-01-poster.jpg
//
// On failure it still writes result.json with an "error" field and exits 1,
// so the caller (GitHub Actions) can commit the error for the web UI to show.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function shortcodeFromUrl(url) {
  const m = url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function extFromContentType(ct) {
  if (!ct) return 'bin';
  if (ct.includes('jpeg')) return 'jpg';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('png')) return 'png';
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('gif')) return 'gif';
  return 'bin';
}

function parseOgDescription(text) {
  // Format: "1,723 likes, 422 comments - skillspace.id on Instagram: "caption...""
  if (!text) return {};
  const m = text.match(/^([\d,\.]+)\s+likes,\s+([\d,\.]+)\s+comments\s+-\s+(\S+)\s+on Instagram:\s+"([\s\S]*)"?$/);
  if (!m) return {};
  return {
    likes: m[1],
    comments: m[2],
    username: m[3],
    caption: (m[4] || '').replace(/"$/, ''),
  };
}

async function closeSignupModal(page) {
  // Instagram shows a "Sign up / Log in" modal on most loads. Close it if present.
  try {
    await page.keyboard.press('Escape');
  } catch { /* ignore */ }
  const candidates = [
    'button[aria-label="Close"]',
    'button:has-text("Not Now")',
    'div[role="dialog"] button >> nth=0',
  ];
  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 800 })) {
        await el.click({ timeout: 800 });
        return;
      }
    } catch { /* try next */ }
  }
}

async function main() {
  const postUrl = arg('--url');
  const jobId = arg('--job', `job-${Date.now()}`);
  const outDir = arg('--out', `results/${jobId}`);
  if (!postUrl) {
    console.error('Missing --url');
    process.exit(2);
  }
  const shortcode = shortcodeFromUrl(postUrl);
  if (!shortcode) {
    console.error('Could not parse a post shortcode from the URL:', postUrl);
    process.exit(2);
  }
  await mkdir(outDir, { recursive: true });
  const result = {
    job_id: jobId,
    post_url: postUrl,
    shortcode,
    extracted_at: new Date().toISOString(),
    type: 'image',
    author: { username: null, display_name: null, verified: false },
    posted_at: null,
    likes: null,
    comments: null,
    caption: null,
    caption_source: null,
    slide_count: 0,
    slides: [],
  };
  const fail = async (code, message) => {
    result.error = message;
    result.error_code = code;
    await writeFile(join(outDir, 'result.json'), JSON.stringify(result, null, 2));
    console.error(`FAILED [${code}]: ${message}`);
    // Throw instead of process.exit so the finally block still closes the browser.
    const err = new Error(`EXTRACT_FAILED:${code}`);
    err.extractFailed = true;
    throw err;
  };

  // Honor an egress proxy when one is configured (e.g. HTTPS_PROXY).
  // Chromium does not read proxy env vars by itself, so pass them explicitly.
  // Only used when the variable is set; GitHub Actions runners have direct
  // internet and skip this entirely.
  let proxy;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      proxy = {
        server: `${u.protocol}//${u.host}`,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      };
    } catch { /* ignore a malformed proxy URL */ }
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true, proxy });
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
      ignoreHTTPSErrors: !!proxy, // proxied egress may use a local CA
    });
    const page = await context.newPage();
    const postBase = `https://www.instagram.com/p/${shortcode}/`;

    // --- 1. Load the post, check it is actually visible without login.
    await page.goto(postBase, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await closeSignupModal(page);
    let hasArticle = false;
    try {
      await page.waitForSelector('article', { timeout: 30000 });
      hasArticle = true;
    } catch {
      hasArticle = false;
    }
    if (!hasArticle) {
      const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 500);
      if (/log in/i.test(bodyText) && /instagram/i.test(bodyText)) {
        return fail('LOGIN_WALL', 'Instagram showed a login wall for this post from this network. Try again later, or extract it from a browser session instead.');
      }
      return fail('NOT_FOUND', 'The post did not load (it may be private, deleted, or restricted). Page text: ' + bodyText);
    }

    // --- 2. Metadata from the page head + oEmbed (no auth needed).
    const og = await page.evaluate(() => {
      const meta = (prop) => document.querySelector(`meta[property="${prop}"]`)?.content || null;
      return {
        description: meta('og:description'),
        title: meta('og:title'),
        image: meta('og:image'),
        type: meta('og:type'),
      };
    });
    const ogParsed = parseOgDescription(og.description);
    if (ogParsed.likes) result.likes = ogParsed.likes;
    if (ogParsed.comments) result.comments = ogParsed.comments;
    if (ogParsed.username) result.author.username = ogParsed.username;

    try {
      const res = await context.request.get(
        `https://api.instagram.com/oembed/?url=${encodeURIComponent(postBase)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (res.ok()) {
        const data = await res.json();
        if (data.author_name) result.author.display_name = data.author_name;
        if (data.title && !result.caption) {
          result.caption = data.title;
          result.caption_source = 'oembed';
        }
      }
    } catch { /* oEmbed is only a fallback */ }

    // --- 3. Caption from the embed page (plain HTML, most reliable source).
    try {
      const embed = await context.newPage();
      await embed.goto(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await embed.waitForSelector('blockquote.instagram-media', { timeout: 20000 });
      const raw = await embed.locator('blockquote.instagram-media').innerText();
      const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
      // Layout: [username] [caption lines...] [A post shared by ...] [View...]
      const sharedIdx = lines.findIndex((l) => /^a post shared by/i.test(l));
      const body = (sharedIdx >= 0 ? lines.slice(0, sharedIdx) : lines).slice(1);
      const caption = body.join('\n').trim();
      if (caption) {
        result.caption = caption;
        result.caption_source = 'embed';
      }
      await embed.close();
    } catch (e) {
      console.error('Embed caption read failed, keeping fallback:', e.message);
    }
    if (!result.caption && ogParsed.caption) {
      result.caption = ogParsed.caption;
      result.caption_source = 'og:description (may be truncated)';
    }

    // --- 4. Author / date / counts from the article itself.
    const articleInfo = await page.evaluate(() => {
      const article = document.querySelector('article');
      if (!article) return {};
      const headerLink = article.querySelector('header a[href^="/"]');
      const timeEl = article.querySelector('time');
      const text = article.innerText || '';
      const likesM = text.match(/([\d,\.]+)\s+likes/);
      const commentsM = text.match(/View all\s+([\d,\.]+)\s+comments/);
      const verified = !!article.querySelector('header [aria-label="Verified"], header svg[aria-label="Verified"]');
      return {
        username: headerLink ? headerLink.getAttribute('href').replace(/\//g, '') : null,
        posted_at: timeEl ? timeEl.getAttribute('datetime') : null,
        likes: likesM ? likesM[1] : null,
        comments: commentsM ? commentsM[1] : null,
        verified,
      };
    });
    if (articleInfo.username) result.author.username = articleInfo.username;
    if (articleInfo.posted_at) result.posted_at = articleInfo.posted_at;
    if (articleInfo.likes) result.likes = articleInfo.likes;
    if (articleInfo.comments) result.comments = articleInfo.comments;
    if (articleInfo.verified) result.author.verified = true;
    if (!result.author.display_name) result.author.display_name = result.author.username;

    // --- 5. Walk the slides via img_index and download each one.
    let prevSrc = null;
    const MAX_SLIDES = 20;
    for (let i = 1; i <= MAX_SLIDES; i++) {
      await page.goto(`${postBase}?img_index=${i}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await closeSignupModal(page);
      try {
        await page.waitForSelector('article', { timeout: 20000 });
      } catch {
        if (i === 1) return fail('NOT_FOUND', 'The post did not load on the slide walk.');
        break;
      }
      const media = await page.evaluate(() => {
        const article = document.querySelector('article');
        if (!article) return null;
        const video = article.querySelector('video');
        const imgs = [...article.querySelectorAll('img')]
          .map((img) => ({
            src: img.currentSrc || img.src,
            w: img.naturalWidth || 0,
            h: img.naturalHeight || 0,
          }))
          .filter((im) => im.w >= 400 && im.src && im.src.includes('cdninstagram'));
        imgs.sort((a, b) => b.w - a.w);
        return {
          img: imgs[0] || null,
          video: video
            ? { src: video.currentSrc || video.src || video.querySelector('source')?.src || null, poster: video.poster || null }
            : null,
        };
      });
      if (!media || (!media.img && !media.video)) {
        if (i === 1) return fail('NO_MEDIA', 'No image or video was found in the post.');
        break;
      }
      const key = media.img ? media.img.src : media.video.src;
      if (prevSrc && key === prevSrc) break; // img_index clamped: same slide again
      prevSrc = key;

      const slideNo = String(result.slides.length + 1).padStart(2, '0');
      if (media.video && media.video.src) {
        result.type = result.slides.length === 0 ? 'video' : result.type;
        const res = await context.request.get(media.video.src, { headers: { Referer: postBase } });
        if (!res.ok()) {
          console.error(`Slide ${i}: video download HTTP ${res.status()}, skipping video file`);
        } else {
          const buf = await res.body();
          const ext = extFromContentType(res.headers()['content-type']);
          const file = `slide-${slideNo}.${ext === 'bin' ? 'mp4' : ext}`;
          await writeFile(join(outDir, file), buf);
          let posterFile = null;
          if (media.video.poster) {
            const pres = await context.request.get(media.video.poster, { headers: { Referer: postBase } });
            if (pres.ok()) {
              posterFile = `slide-${slideNo}-poster.jpg`;
              await writeFile(join(outDir, posterFile), await pres.body());
            }
          }
          result.slides.push({ index: result.slides.length + 1, kind: 'video', file, poster: posterFile });
          continue;
        }
      }
      if (!media.img) break;
      const res = await context.request.get(media.img.src, { headers: { Referer: postBase } });
      if (!res.ok()) return fail('DOWNLOAD_FAILED', `Slide ${i}: image download failed with HTTP ${res.status()}.`);
      const buf = await res.body();
      const ext = extFromContentType(res.headers()['content-type']);
      const file = `slide-${slideNo}.${ext === 'bin' ? 'jpg' : ext}`;
      await writeFile(join(outDir, file), buf);
      result.slides.push({
        index: result.slides.length + 1,
        kind: 'image',
        file,
        width: media.img.w,
        height: media.img.h,
      });
      console.log(`Slide ${i}: ${file} (${media.img.w}x${media.img.h}, ${buf.length} bytes)`);
    }

    if (result.slides.length === 0) return fail('NO_MEDIA', 'No slides could be downloaded.');
    result.slide_count = result.slides.length;
    if (result.slides.length > 1) result.type = 'carousel';
    await writeFile(join(outDir, 'result.json'), JSON.stringify(result, null, 2));
    console.log(`Done: ${result.slide_count} slide(s), caption ${result.caption ? result.caption.length + ' chars' : 'missing'}`);
  } catch (e) {
    if (!e.extractFailed) {
      result.error = 'Unexpected error: ' + (e.message || String(e));
      result.error_code = 'UNEXPECTED';
      try {
        await writeFile(join(outDir, 'result.json'), JSON.stringify(result, null, 2));
      } catch { /* out dir may not exist yet */ }
    }
    throw e;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch(async (e) => {
  console.error('Unexpected error:', e);
  if (e.extractFailed) process.exit(1);
  process.exit(2);
});
