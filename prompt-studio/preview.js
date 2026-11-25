/**
 * preview.js - Client-Side Image Preview Engine (Tier 1 Zero-Auth + Tier 2 BYOK)
 * Adapts the cascading fallback architecture of ffmpeg-ai for zero-build browser
 * execution (GitHub Pages & local file:/// usage), strictly keeping API keys in browser memory/localStorage.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlunaWebImagePreview = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- Tier 1 Endpoints (Zero-Auth Required) ---
  const POLLINATIONS_ENDPOINT = 'https://image.pollinations.ai/prompt/';
  const POLLINATIONS_MODELS = ['flux', 'flux-realism'];
  const AI_HORDE_API = 'https://aihorde.net/api/v2';
  const AI_HORDE_GUEST_KEY = '0000000000';
  const AI_HORDE_CLIENT_AGENT = 'AlunaPromptStudioWeb:2.0:github.com/alamaby/online-tools';

  const AI_HORDE_MODELS_REALISTIC = [
    'Juggernaut XL',
    'AlbedoBase XL 3.1',
    'AlbedoBase XL (SDXL)',
  ];
  const AI_HORDE_MODELS_ANIME = [
    'AlbedoBase XL 3.1',
    'Juggernaut XL',
    'AlbedoBase XL (SDXL)',
  ];

  const HORDE_POLL_INTERVAL_MS = 5000;
  const HORDE_MAX_POLLS = 48;

  // --- Tier 2 BYOK Endpoints (Browser CORS Verified) ---
  const POLLINATIONS_GEN_ENDPOINT = 'https://gen.pollinations.ai/image/';
  const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
  const PIXAZO_ENDPOINTS = {
    'pixazo-flux-1-schnell': 'https://gateway.pixazo.ai/flux-1-schnell/v1/getData',
    'pixazo-sdxl-1.0': 'https://gateway.pixazo.ai/getImage/v1/getSDXLImage',
  };
  const TOGETHER_ENDPOINT = 'https://api.together.xyz/v1/images/generations';
  const HF_ROUTER_BASE = 'https://router.huggingface.co/hf-inference/models';

  const TIER2_MODEL_CATALOG = {
    gemini: [
      { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image (Cepat & Stabil)' },
      { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image Preview (Terbaru)' },
    ],
    pollinations_key: [
      { id: 'flux', label: 'Flux.1 Schnell (Seimbang & Tajam)' },
      { id: 'zimage', label: 'Z-Image Turbo (Cepat)' },
      { id: 'flux-klein', label: 'Flux.2 Klein 4B (Modern Ringan)' },
      { id: 'kontext', label: 'Flux.1 Kontext Pro (Detail Tinggi)' },
    ],
    pixazo: [
      { id: 'pixazo-flux-1-schnell', label: 'Pixazo FLUX.1 Schnell (Free Tier)' },
      { id: 'pixazo-sdxl-1.0', label: 'Pixazo SDXL 1.0 (+ Negative Prompt)' },
    ],
    together: [
      { id: 'black-forest-labs/FLUX.1-schnell-Free', label: 'FLUX.1 Schnell Free -> Fallback Paid' },
      { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1 Schnell (Trial/Serverless)' },
    ],
    huggingface: [
      { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1 Schnell (12B)' },
      { id: 'stabilityai/stable-diffusion-xl-base-1.0', label: 'SDXL 1.0 Base (+ Negative)' },
    ],
  };

  const GEMINI_SUPPORTED_ASPECT_RATIOS = new Set([
    '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
  ]);

  // Priority order when `byok_auto` cascades across configured Tier 2 keys
  const TIER2_CASCADE_ORDER = [
    'gemini',
    'pollinations_key',
    'pixazo',
    'together',
    'huggingface',
  ];

  // Track IP-level cooldown returned by free image.pollinations.ai (HTTP 402/429)
  let pollinationsCooldownUntil = 0;

  function getPollinationsCooldownRemainingSec() {
    const diff = pollinationsCooldownUntil - Date.now();
    return diff > 0 ? Math.ceil(diff / 1000) : 0;
  }

  function sanitizeErrorMessage(text, limit = 360) {
    if (!text) return '';
    let clean = String(text)
      .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer <redacted>')
      .replace(/((?:x-goog-api-key|ocp-apim-subscription-key|apikey|api_key|token|secret)\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1<redacted>')
      .replace(/([?&](?:key|token|apikey)=)[^&\s"']+/gi, '$1<redacted>')
      .replace(/\b(?:AIza[0-9A-Za-z\-_]{16,}|hf_[A-Za-z0-9]{16,}|(?:plln_)?(?:sk|pk)_[A-Za-z0-9_-]{12,})\b/g, '<redacted>')
      .replace(/[\r\n]+/g, ' ')
      .trim();

    if (clean.length > limit) {
      clean = clean.slice(0, limit).trim() + '...';
    }
    return clean;
  }

  function parseRetryAfterSeconds(errorPayloadText, retryAfterHeader) {
    if (retryAfterHeader) {
      const parsedHeader = parseInt(retryAfterHeader, 10);
      if (Number.isFinite(parsedHeader) && parsedHeader > 0) {
        return parsedHeader;
      }
    }
    if (errorPayloadText) {
      const match = String(errorPayloadText).match(/retry\s+after\s+(\d+)\s*s/i);
      if (match) {
        const sec = parseInt(match[1], 10);
        if (Number.isFinite(sec) && sec > 0) return sec;
      }
    }
    return 45;
  }

  function createAbortError() {
    const err = new Error('Generasi preview dibatalkan oleh pengguna.');
    err.name = 'AbortError';
    return err;
  }

  function sleepWithAbort(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(createAbortError());
        return;
      }
      function onAbort() {
        clearTimeout(timer);
        reject(createAbortError());
      }
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  function emitStatus(onStatus, payload) {
    if (typeof onStatus === 'function') {
      onStatus(payload);
    }
  }

  function snapDimensions(width, height, { step = 16, minEdge = 256, maxEdge = 1280 } = {}) {
    const rawW = Number(width) || 1024;
    const rawH = Number(height) || 576;
    const scale = Math.max(rawW, rawH) > maxEdge ? maxEdge / Math.max(rawW, rawH) : 1;
    const snap = (val) => {
      const scaled = Math.max(minEdge, Math.round(val * scale));
      return Math.max(minEdge, Math.round(scaled / step) * step);
    };
    return { width: snap(rawW), height: snap(rawH) };
  }

  function trimPromptOnBoundary(text, maxChars) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxChars) return clean;
    const slice = clean.slice(0, maxChars);
    const lastPeriod = slice.lastIndexOf('. ');
    if (lastPeriod >= Math.floor(maxChars * 0.5)) {
      return slice.slice(0, lastPeriod + 1).trim();
    }
    const lastSpace = slice.lastIndexOf(' ');
    return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
  }

  function base64ToBlob(b64, mimeType = 'image/png') {
    const clean = String(b64).includes(',') ? String(b64).split(',', 2)[1] : String(b64);
    const binStr = atob(clean.trim());
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }

  async function readHttpErrorDetail(resp) {
    const raw = await resp.text().catch(() => '');
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      const nested =
        (parsed && parsed.error && parsed.error.message) ||
        (parsed && parsed.message) ||
        (parsed && parsed.detail) ||
        (typeof (parsed && parsed.error) === 'string' ? parsed.error : '');
      if (nested) return sanitizeErrorMessage(nested);
    } catch (_) {
      // Plain text error body
    }
    return sanitizeErrorMessage(raw);
  }

  async function resolveUrlOrBlobResult(imgUrl, meta, signal) {
    try {
      const imgResp = await fetch(imgUrl, { method: 'GET', signal });
      if (imgResp.ok) {
        const blob = await imgResp.blob();
        if (blob && blob.size >= 512) {
          const objectUrl = URL.createObjectURL(blob);
          return Object.assign({}, meta, {
            src: objectUrl,
            blob,
            isObjectUrl: true,
            mimeType: blob.type || meta.mimeType || 'image/png',
          });
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      // If external CDN blocks CORS fetch, fall back to direct <img src>
    }
    return Object.assign({}, meta, {
      src: imgUrl,
      blob: null,
      isObjectUrl: false,
    });
  }

  async function extractImageFromJsonPayload(data, meta, signal) {
    const inspectCandidate = async (val) => {
      if (typeof val !== 'string' || !val.trim()) return null;
      const trimmed = val.trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return resolveUrlOrBlobResult(trimmed, meta, signal);
      }
      if (trimmed.startsWith('data:image/')) {
        const mimeMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
        const mime = mimeMatch ? mimeMatch[1] : meta.mimeType || 'image/png';
        const blob = base64ToBlob(trimmed, mime);
        return Object.assign({}, meta, {
          src: URL.createObjectURL(blob),
          blob,
          isObjectUrl: true,
          mimeType: mime,
        });
      }
      if (trimmed.length > 200 && /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed)) {
        const mime = meta.mimeType || 'image/png';
        const blob = base64ToBlob(trimmed, mime);
        return Object.assign({}, meta, {
          src: URL.createObjectURL(blob),
          blob,
          isObjectUrl: true,
          mimeType: mime,
        });
      }
      return null;
    };

    if (data && Array.isArray(data.data) && data.data.length > 0) {
      const item = data.data[0];
      if (item && item.b64_json) {
        const mime = meta.mimeType || 'image/png';
        const blob = base64ToBlob(item.b64_json, mime);
        return Object.assign({}, meta, {
          src: URL.createObjectURL(blob),
          blob,
          isObjectUrl: true,
          mimeType: mime,
        });
      }
      if (item && item.url) {
        return resolveUrlOrBlobResult(item.url, meta, signal);
      }
    }

    const keys = ['image_url', 'imageUrl', 'url', 'image', 'output', 'b64_json', 'data'];
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const k of keys) {
        const found = await inspectCandidate(data[k]);
        if (found) return found;
        if (Array.isArray(data[k]) && data[k].length > 0) {
          const nested = await inspectCandidate(data[k][0]);
          if (nested) return nested;
        }
      }
    } else if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (typeof first === 'string') {
        const strHit = await inspectCandidate(first);
        if (strHit) return strHit;
      } else if (first && typeof first === 'object') {
        for (const k of keys) {
          const found = await inspectCandidate(first[k]);
          if (found) return found;
        }
      }
    }

    return null;
  }

  function pickHordeModels(artStyleId) {
    const id = String(artStyleId || '').toLowerCase();
    if (
      id.includes('photoreal') ||
      id.includes('cinematic') ||
      id.includes('3d') ||
      id.includes('ff7') ||
      id.includes('cyberpunk')
    ) {
      return AI_HORDE_MODELS_REALISTIC;
    }
    return AI_HORDE_MODELS_ANIME;
  }

  function buildPollinationsUrl(prompt, { width, height, seed, model, endpoint = POLLINATIONS_ENDPOINT }) {
    const encodedPrompt = encodeURIComponent(prompt);
    return (
      `${endpoint}${encodedPrompt}` +
      `?width=${width}&height=${height}&seed=${seed}&nologo=true&model=${encodeURIComponent(model)}`
    );
  }

  // --- Tier 1: Pollinations Zero-Auth ---
  async function tryPollinations(
    { prompt, width, height, seed },
    { signal, onStatus } = {}
  ) {
    const remaining = getPollinationsCooldownRemainingSec();
    if (remaining > 0) {
      const err = new Error(
        `Pollinations sedang cooldown (${remaining} detik lagi, batas gratis 1 gambar/45 detik per IP).`
      );
      err.code = 'POLLINATIONS_COOLDOWN';
      err.retryAfterSec = remaining;
      throw err;
    }

    let lastError = null;

    for (const model of POLLINATIONS_MODELS) {
      if (signal && signal.aborted) throw createAbortError();

      emitStatus(onStatus, {
        stage: 'pollinations',
        provider: 'pollinations',
        model,
        message: `Menghubungi Pollinations.ai (${model})...`,
      });

      const url = buildPollinationsUrl(prompt, { width, height, seed, model });

      let resp;
      try {
        resp = await fetch(url, { method: 'GET', signal });
      } catch (fetchErr) {
        if (fetchErr && fetchErr.name === 'AbortError') throw fetchErr;
        lastError = fetchErr;
        continue;
      }

      if (resp.status === 402 || resp.status === 429) {
        const bodyText = await resp.text().catch(() => '');
        const waitSec = parseRetryAfterSeconds(bodyText, resp.headers.get('Retry-After'));
        pollinationsCooldownUntil = Date.now() + waitSec * 1000;
        const limitErr = new Error(
          `Batas gratis Pollinations tercapai (tunggu ${waitSec} detik).`
        );
        limitErr.code = 'POLLINATIONS_RATE_LIMIT';
        limitErr.status = resp.status;
        limitErr.retryAfterSec = waitSec;
        throw limitErr;
      }

      if (!resp.ok) {
        lastError = new Error(`Pollinations HTTP ${resp.status}`);
        continue;
      }

      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (!ct.startsWith('image/')) {
        lastError = new Error(`Pollinations mengembalikan non-gambar (${ct || 'unknown'})`);
        continue;
      }

      const blob = await resp.blob();
      if (!blob || blob.size < 1024) {
        lastError = new Error('Ukuran gambar Pollinations terlalu kecil / korup.');
        continue;
      }

      return {
        src: URL.createObjectURL(blob),
        blob,
        isObjectUrl: true,
        provider: 'pollinations',
        providerLabel: 'Pollinations.ai (Gratis)',
        tier: 1,
        model,
        width,
        height,
        seed,
        mimeType: blob.type || ct || 'image/jpeg',
        sentPrompt: prompt,
      };
    }

    throw lastError || new Error('Pollinations gagal menghasilkan gambar.');
  }

  // --- Tier 1/2: AI Horde (Guest 0000000000 or Registered Free Key) ---
  async function tryAiHorde(
    { prompt, negativePrompt, width, height, seed, artStyleId, apiKey },
    { signal, onStatus } = {}
  ) {
    const key = (apiKey && String(apiKey).trim()) || AI_HORDE_GUEST_KEY;
    const isRegistered = key !== AI_HORDE_GUEST_KEY;
    const models = pickHordeModels(artStyleId);
    const combinedPrompt = negativePrompt ? `${prompt} ### ${negativePrompt}` : prompt;

    emitStatus(onStatus, {
      stage: 'horde_submit',
      provider: 'stable_horde',
      message: isRegistered
        ? 'Mengirim job ke antrean AI Horde (Registered Key)...'
        : 'Mengirim job ke antrean AI Horde (Guest)...',
    });

    const submitResp = await fetch(`${AI_HORDE_API}/generate/async`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        'Client-Agent': AI_HORDE_CLIENT_AGENT,
      },
      body: JSON.stringify({
        prompt: combinedPrompt,
        params: {
          width,
          height,
          steps: 25,
          sampler_name: 'k_euler_a',
          cfg_scale: 7,
          n: 1,
          seed: String(seed),
        },
        models,
        nsfw: false,
        censor_nsfw: true,
        r2: false,
        shared: false,
      }),
    });

    if (!submitResp.ok) {
      const errDetail = await readHttpErrorDetail(submitResp);
      throw new Error(
        `AI Horde menolak permintaan (HTTP ${submitResp.status})${errDetail ? ': ' + errDetail : ''}`
      );
    }

    const submitData = await submitResp.json();
    const jobId = submitData && submitData.id;
    if (!jobId) {
      throw new Error('AI Horde tidak mengembalikan job ID.');
    }

    for (let poll = 0; poll < HORDE_MAX_POLLS; poll++) {
      await sleepWithAbort(HORDE_POLL_INTERVAL_MS, signal);

      const checkResp = await fetch(`${AI_HORDE_API}/generate/check/${jobId}`, {
        method: 'GET',
        signal,
        headers: { 'Client-Agent': AI_HORDE_CLIENT_AGENT },
      });

      if (!checkResp.ok) continue;
      const checkData = await checkResp.json();

      if (checkData.faulted) {
        throw new Error('Worker AI Horde mengalami kegagalan (faulted).');
      }
      if (checkData.is_possible === false) {
        throw new Error('Tidak ada worker AI Horde yang aktif untuk model/ukuran ini.');
      }

      if (checkData.done) {
        emitStatus(onStatus, {
          stage: 'horde_download',
          provider: 'stable_horde',
          message: 'Mengunduh hasil gambar dari AI Horde...',
        });

        const statusResp = await fetch(`${AI_HORDE_API}/generate/status/${jobId}`, {
          method: 'GET',
          signal,
          headers: { 'Client-Agent': AI_HORDE_CLIENT_AGENT },
        });
        if (!statusResp.ok) {
          throw new Error(`Gagal mengambil status akhir AI Horde (HTTP ${statusResp.status}).`);
        }

        const statusData = await statusResp.json();
        const gen = statusData && statusData.generations && statusData.generations[0];
        const rawImg = gen && gen.img;
        if (!rawImg || rawImg.length < 100) {
          throw new Error('AI Horde selesai tetapi data gambar kosong.');
        }

        const usedModel = gen.model || models[0];
        const baseMeta = {
          provider: 'stable_horde',
          providerLabel: isRegistered ? 'AI Horde (Registered)' : 'AI Horde',
          tier: isRegistered ? 2 : 1,
          model: usedModel,
          width,
          height,
          seed,
          mimeType: 'image/webp',
          sentPrompt: prompt,
        };

        if (rawImg.startsWith('http://') || rawImg.startsWith('https://')) {
          return resolveUrlOrBlobResult(rawImg, baseMeta, signal);
        }

        const blob = base64ToBlob(rawImg, 'image/webp');
        return Object.assign({}, baseMeta, {
          src: URL.createObjectURL(blob),
          blob,
          isObjectUrl: true,
        });
      }

      const qPos = checkData.queue_position ?? '?';
      const waitSec = checkData.wait_time ?? '?';
      emitStatus(onStatus, {
        stage: 'horde_queue',
        provider: 'stable_horde',
        queuePosition: qPos,
        waitTime: waitSec,
        message: `Menunggu antrean AI Horde... Posisi #${qPos}, estimasi ~${waitSec}s`,
      });
    }

    throw new Error('Antrean AI Horde melebihi batas waktu tunggu (~4 menit).');
  }

  // --- Tier 2: Google Gemini Image (with optional Reference Image inlineData) ---
  async function tryGemini(
    { prompt, aspectRatioId = '16:9', width, height, seed, modelId, apiKey, referenceImages = [], framingMode = 'studio' },
    { signal, onStatus } = {}
  ) {
    const key = apiKey && String(apiKey).trim();
    if (!key) {
      throw new Error('Google Gemini API Key belum diisi di panel Konfigurasi Key Tier 2.');
    }

    const chosenModel = modelId || TIER2_MODEL_CATALOG.gemini[0].id;
    const safeAr = GEMINI_SUPPORTED_ASPECT_RATIOS.has(aspectRatioId) ? aspectRatioId : '16:9';

    emitStatus(onStatus, {
      stage: 'gemini',
      provider: 'gemini',
      model: chosenModel,
      message: referenceImages.length
        ? `Mengirim prompt + ${referenceImages.length} foto referensi ke Google Gemini (${chosenModel})...`
        : `Menghubungi Google Gemini (${chosenModel})...`,
    });

    const parts = [];
    if (Array.isArray(referenceImages) && referenceImages.length > 0) {
      parts.push({
        text:
          'Please generate a new image featuring the exact same character shown in the attached reference image(s). ' +
          'Maintain strict visual fidelity to her facial features, porcelain-bright fair skin, eyes, and hairstyle as depicted.\n\n',
      });
      referenceImages.slice(0, 3).forEach((ref) => {
        if (ref && ref.data) {
          parts.push({
            inline_data: {
              mime_type: ref.mimeType || 'image/jpeg',
              data: ref.data,
            },
          });
        }
      });
    }

    const framingDirective = framingMode && framingMode !== 'studio'
      ? ' Framing Requirement: Show complete head-to-toe full body portrait including shoes cleanly inside the frame.'
      : '';
    const finalInstruction = `Target Aspect Ratio: ${safeAr}.${framingDirective}\n${prompt}`;
    parts.push({ text: finalInstruction });

    const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(chosenModel)}:generateContent`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: safeAr,
          },
        },
      }),
    });

    if (!resp.ok) {
      const detail = await readHttpErrorDetail(resp);
      const billingHint = (resp.status === 429 || resp.status === 403) && /quota|billing|free_tier|limit:\s*0/i.test(detail)
        ? ' (Catatan: model gambar Gemini sering memerlukan akun AI Studio dengan billing aktif/kredit)'
        : '';
      throw new Error(`Gemini HTTP ${resp.status}${detail ? ': ' + detail : ''}${billingHint}`);
    }

    const data = await resp.json();
    const candidates = (data && data.candidates) || [];
    if (!candidates.length) {
      const errDetail = (data && data.error && data.error.message) || JSON.stringify(data || {});
      throw new Error(`Gemini tidak mengembalikan gambar: ${sanitizeErrorMessage(errDetail)}`);
    }

    const contentParts = (candidates[0].content && candidates[0].content.parts) || [];
    let foundImage = null;
    const textMessages = [];

    for (const part of contentParts) {
      const inline = part && (part.inlineData || part.inline_data);
      if (inline && inline.data) {
        foundImage = {
          data: inline.data,
          mimeType: inline.mimeType || inline.mime_type || 'image/png',
        };
        break;
      }
      if (part && part.text) {
        textMessages.push(part.text);
      }
    }

    if (!foundImage) {
      const modelReply = sanitizeErrorMessage(textMessages.join(' '), 220);
      throw new Error(
        `Gemini tidak menghasilkan gambar.${modelReply ? ' Pesan model: ' + modelReply : ''}`
      );
    }

    const blob = base64ToBlob(foundImage.data, foundImage.mimeType);
    return {
      src: URL.createObjectURL(blob),
      blob,
      isObjectUrl: true,
      provider: 'gemini',
      providerLabel: 'Google Gemini Image',
      tier: 2,
      model: chosenModel,
      width,
      height,
      seed,
      mimeType: foundImage.mimeType,
      sentPrompt: finalInstruction,
    };
  }

  // --- Tier 2: Pollinations Keyed (gen.pollinations.ai) ---
  async function tryPollinationsKeyed(
    { prompt, naturalPrompt, width, height, seed, modelId, apiKey },
    { signal, onStatus } = {}
  ) {
    const key = apiKey && String(apiKey).trim();
    if (!key) {
      throw new Error('Pollinations Pollen Key (pk_/sk_) belum diisi di panel Konfigurasi Key Tier 2.');
    }

    const chosenModel = modelId || TIER2_MODEL_CATALOG.pollinations_key[0].id;
    // Keep URL GET query concise and well inside URL length caps
    const chosenPrompt = chosenModel === 'flux'
      ? prompt
      : trimPromptOnBoundary(naturalPrompt || prompt, 900);

    emitStatus(onStatus, {
      stage: 'pollinations_key',
      provider: 'pollinations_key',
      model: chosenModel,
      message: `Menghubungi gen.pollinations.ai (${chosenModel})...`,
    });

    const url = buildPollinationsUrl(chosenPrompt, {
      width,
      height,
      seed,
      model: chosenModel,
      endpoint: POLLINATIONS_GEN_ENDPOINT,
    });

    const resp = await fetch(url, {
      method: 'GET',
      signal,
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (!resp.ok) {
      const detail = await readHttpErrorDetail(resp);
      throw new Error(`Pollinations Keyed HTTP ${resp.status}${detail ? ': ' + detail : ''}`);
    }

    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) {
      throw new Error(`Pollinations Keyed mengembalikan non-gambar (${ct || 'unknown'})`);
    }

    const blob = await resp.blob();
    if (!blob || blob.size < 1024) {
      throw new Error('Ukuran gambar Pollinations Keyed terlalu kecil / korup.');
    }

    return {
      src: URL.createObjectURL(blob),
      blob,
      isObjectUrl: true,
      provider: 'pollinations_key',
      providerLabel: 'Pollinations Keyed',
      tier: 2,
      model: chosenModel,
      width,
      height,
      seed,
      mimeType: blob.type || ct || 'image/jpeg',
      sentPrompt: chosenPrompt,
    };
  }

  // --- Tier 2: Pixazo AI Gateway ---
  async function tryPixazo(
    { pollinationsPrompt, hordePrompt, negativePrompt, width, height, seed, modelId, apiKey },
    { signal, onStatus } = {}
  ) {
    const key = apiKey && String(apiKey).trim();
    if (!key) {
      throw new Error('Pixazo Subscription Key belum diisi di panel Konfigurasi Key Tier 2.');
    }

    const chosenModel = PIXAZO_ENDPOINTS[modelId] ? modelId : 'pixazo-flux-1-schnell';
    const endpoint = PIXAZO_ENDPOINTS[chosenModel];
    const dims = snapDimensions(width, height, { step: 16, minEdge: 512, maxEdge: 1024 });

    let payload;
    let usedPrompt;
    if (chosenModel === 'pixazo-sdxl-1.0') {
      usedPrompt = trimPromptOnBoundary(hordePrompt || pollinationsPrompt, 1500);
      payload = {
        prompt: usedPrompt,
        negative_prompt: negativePrompt || 'low quality, blurry, deformed anatomy, extra fingers, text, watermark',
        width: dims.width,
        height: dims.height,
        num_steps: 25,
        guidance_scale: 7.5,
      };
    } else {
      usedPrompt = pollinationsPrompt;
      payload = { prompt: usedPrompt };
    }

    emitStatus(onStatus, {
      stage: 'pixazo',
      provider: 'pixazo',
      model: chosenModel,
      message: `Menghubungi Pixazo AI Gateway (${chosenModel})...`,
    });

    const resp = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Ocp-Apim-Subscription-Key': key,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const detail = await readHttpErrorDetail(resp);
      throw new Error(`Pixazo HTTP ${resp.status}${detail ? ': ' + detail : ''}`);
    }

    const meta = {
      provider: 'pixazo',
      providerLabel: 'Pixazo AI',
      tier: 2,
      model: chosenModel,
      width: dims.width,
      height: dims.height,
      seed,
      mimeType: 'image/png',
      sentPrompt: usedPrompt,
    };

    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('image/')) {
      const blob = await resp.blob();
      return Object.assign({}, meta, {
        src: URL.createObjectURL(blob),
        blob,
        isObjectUrl: true,
        mimeType: blob.type || ct,
      });
    }

    const jsonData = await resp.json().catch(() => null);
    const extracted = await extractImageFromJsonPayload(jsonData, meta, signal);
    if (!extracted) {
      throw new Error('Respons Pixazo tidak mengandung URL atau data gambar yang valid.');
    }
    return extracted;
  }

  // --- Tier 2: Together AI ---
  async function tryTogether(
    { prompt, width, height, seed, modelId, apiKey },
    { signal, onStatus } = {}
  ) {
    const key = apiKey && String(apiKey).trim();
    if (!key) {
      throw new Error('Together AI API Key belum diisi di panel Konfigurasi Key Tier 2.');
    }

    const preferred = modelId || TIER2_MODEL_CATALOG.together[0].id;
    const candidateModels = [preferred];
    if (preferred === 'black-forest-labs/FLUX.1-schnell-Free') {
      candidateModels.push('black-forest-labs/FLUX.1-schnell');
    }

    const dims = snapDimensions(width, height, { step: 16, minEdge: 512, maxEdge: 1440 });
    let lastError = null;

    for (const model of candidateModels) {
      if (signal && signal.aborted) throw createAbortError();

      emitStatus(onStatus, {
        stage: 'together',
        provider: 'together',
        model,
        message: `Menghubungi Together AI (${model.split('/').pop()})...`,
      });

      const resp = await fetch(TOGETHER_ENDPOINT, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          width: dims.width,
          height: dims.height,
          steps: 4,
          n: 1,
          seed,
          response_format: 'b64_json',
        }),
      });

      if (!resp.ok) {
        const detail = await readHttpErrorDetail(resp);
        const err = new Error(`Together AI HTTP ${resp.status}${detail ? ': ' + detail : ''}`);
        // Retry with serverless FLUX.1-schnell only when -Free is unavailable/404/400
        if ((resp.status === 400 || resp.status === 404) && model !== candidateModels[candidateModels.length - 1]) {
          lastError = err;
          continue;
        }
        throw err;
      }

      const data = await resp.json();
      const extracted = await extractImageFromJsonPayload(
        data,
        {
          provider: 'together',
          providerLabel: 'Together AI',
          tier: 2,
          model,
          width: dims.width,
          height: dims.height,
          seed,
          mimeType: 'image/png',
          sentPrompt: prompt,
        },
        signal
      );

      if (!extracted) {
        lastError = new Error('Together AI tidak mengembalikan b64_json maupun URL gambar.');
        continue;
      }
      return extracted;
    }

    throw lastError || new Error('Together AI gagal menghasilkan gambar.');
  }

  // --- Tier 2: HuggingFace Inference Router ---
  async function tryHuggingFace(
    { pollinationsPrompt, hordePrompt, negativePrompt, width, height, seed, modelId, apiKey },
    { signal, onStatus } = {}
  ) {
    const key = apiKey && String(apiKey).trim();
    if (!key) {
      throw new Error('HuggingFace Token (HF_TOKEN) belum diisi di panel Konfigurasi Key Tier 2.');
    }

    const preferred = modelId || TIER2_MODEL_CATALOG.huggingface[0].id;
    const candidateModels = [preferred];
    TIER2_MODEL_CATALOG.huggingface.forEach((m) => {
      if (!candidateModels.includes(m.id)) candidateModels.push(m.id);
    });

    const dims = snapDimensions(width, height, { step: 16, minEdge: 512, maxEdge: 1024 });
    let lastError = null;

    for (const model of candidateModels) {
      if (signal && signal.aborted) throw createAbortError();

      const isSdxl = /stable-diffusion-xl/i.test(model);
      const usedPrompt = isSdxl ? trimPromptOnBoundary(hordePrompt || pollinationsPrompt, 1200) : pollinationsPrompt;
      const bodyPayload = {
        inputs: usedPrompt,
        parameters: Object.assign(
          { width: dims.width, height: dims.height },
          isSdxl && negativePrompt ? { negative_prompt: negativePrompt } : {}
        ),
      };

      const endpoint = `${HF_ROUTER_BASE}/${model}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        emitStatus(onStatus, {
          stage: 'huggingface',
          provider: 'huggingface',
          model,
          message: `Menghubungi HuggingFace Router (${model.split('/').pop()})...`,
        });

        const resp = await fetch(endpoint, {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
        });

        if (resp.status === 503 && attempt === 0) {
          const warmJson = await resp.json().catch(() => ({}));
          const waitSec = Math.min(Math.max(Math.ceil(warmJson.estimated_time || 15), 3), 25);
          emitStatus(onStatus, {
            stage: 'huggingface_warmup',
            provider: 'huggingface',
            model,
            message: `Model HuggingFace sedang warmup (~${waitSec}s), mencoba ulang otomatis...`,
          });
          await sleepWithAbort(waitSec * 1000, signal);
          continue;
        }

        if (!resp.ok) {
          const detail = await readHttpErrorDetail(resp);
          const creditHint = resp.status === 402
            ? ' (Paket Free HF kini $0 kredit router; perlu HF PRO atau kredit pre-paid)'
            : '';
          const err = new Error(`HuggingFace HTTP ${resp.status}${detail ? ': ' + detail : ''}${creditHint}`);
          if (resp.status === 401 || resp.status === 402 || resp.status === 403) {
            throw err;
          }
          lastError = err;
          break;
        }

        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (!ct.startsWith('image/')) {
          lastError = new Error(`HuggingFace mengembalikan non-gambar (${ct || 'unknown'})`);
          break;
        }

        const blob = await resp.blob();
        return {
          src: URL.createObjectURL(blob),
          blob,
          isObjectUrl: true,
          provider: 'huggingface',
          providerLabel: 'HuggingFace Router',
          tier: 2,
          model,
          width: dims.width,
          height: dims.height,
          seed,
          mimeType: blob.type || ct || 'image/jpeg',
          sentPrompt: usedPrompt,
        };
      }
    }

    throw lastError || new Error('HuggingFace Router gagal menghasilkan gambar.');
  }

  // --- Unified Provider Dispatcher ---
  async function runSingleTier2Provider(providerId, params, callbacks) {
    const {
      pollinationsPrompt,
      hordePrompt,
      naturalPrompt,
      negativePrompt,
      width,
      height,
      seed,
      aspectRatioId,
      framingMode,
      keys = {},
      models = {},
      referenceImages = [],
    } = params;

    switch (providerId) {
      case 'gemini':
        return tryGemini(
          {
            prompt: naturalPrompt || hordePrompt || pollinationsPrompt,
            aspectRatioId,
            width,
            height,
            seed,
            modelId: models.gemini,
            apiKey: keys.gemini,
            referenceImages,
            framingMode,
          },
          callbacks
        );
      case 'pollinations_key':
        return tryPollinationsKeyed(
          {
            prompt: pollinationsPrompt,
            naturalPrompt,
            width,
            height,
            seed,
            modelId: models.pollinationsGen,
            apiKey: keys.pollinations,
          },
          callbacks
        );
      case 'pixazo':
        return tryPixazo(
          {
            pollinationsPrompt,
            hordePrompt,
            negativePrompt,
            width,
            height,
            seed,
            modelId: models.pixazo,
            apiKey: keys.pixazo,
          },
          callbacks
        );
      case 'together':
        return tryTogether(
          {
            prompt: pollinationsPrompt,
            width,
            height,
            seed,
            modelId: models.together,
            apiKey: keys.together,
          },
          callbacks
        );
      case 'huggingface':
        return tryHuggingFace(
          {
            pollinationsPrompt,
            hordePrompt,
            negativePrompt,
            width,
            height,
            seed,
            modelId: models.huggingface,
            apiKey: keys.huggingface,
          },
          callbacks
        );
      default:
        throw new Error(`Provider Tier 2 tidak dikenal: ${providerId}`);
    }
  }

  async function runTier1Cascade(
    {
      onlyProvider = null,
      pollinationsPrompt,
      hordePrompt,
      negativePrompt,
      width,
      height,
      seed,
      artStyleId,
      hordeApiKey,
      fallbackReason = '',
    },
    { signal, onStatus } = {}
  ) {
    let reason = fallbackReason;

    if (!onlyProvider || onlyProvider === 'pollinations') {
      try {
        const res = await tryPollinations(
          { prompt: pollinationsPrompt, width, height, seed },
          { signal, onStatus }
        );
        return Object.assign(res, reason ? { fallbackReason: reason } : {});
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        if (onlyProvider === 'pollinations') throw err;
        reason = reason
          ? `${reason}; ${(err && err.message) || 'Pollinations gagal'}`
          : (err && err.message) || 'Pollinations tidak tersedia';
        emitStatus(onStatus, {
          stage: 'fallback',
          provider: 'stable_horde',
          message: `${err && err.message ? err.message : 'Pollinations gagal'} — beralih ke AI Horde...`,
        });
      }
    }

    const hordeRes = await tryAiHorde(
      {
        prompt: hordePrompt || pollinationsPrompt,
        negativePrompt,
        width,
        height,
        seed,
        artStyleId,
        apiKey: hordeApiKey,
      },
      { signal, onStatus }
    );
    return Object.assign(hordeRes, reason ? { fallbackReason: reason } : {});
  }

  function hasKeyForTier2Provider(providerId, keys) {
    const keyMap = {
      gemini: keys.gemini,
      pollinations_key: keys.pollinations,
      pixazo: keys.pixazo,
      together: keys.together,
      huggingface: keys.huggingface,
    };
    return Boolean(keyMap[providerId] && String(keyMap[providerId]).trim());
  }

  async function generatePreview(params, { signal, onStatus } = {}) {
    const startMs = Date.now();
    const {
      providerMode = 'auto',
      pollinationsPrompt = '',
      hordePrompt = '',
      naturalPrompt = '',
      negativePrompt = '',
      width = 1024,
      height = 576,
      seed = 42,
      artStyleId = '',
      aspectRatioId = '16:9',
      framingMode = 'studio',
      hordeApiKey = '',
      keys = {},
      models = {},
      referenceImages = [],
    } = params || {};

    const normalizedKeys = Object.assign(
      {
        gemini: '',
        pollinations: '',
        pixazo: '',
        together: '',
        huggingface: '',
        horde: hordeApiKey || '',
      },
      keys
    );
    const effectiveHordeKey = normalizedKeys.horde || hordeApiKey || '';

    // 1. Explicit single Tier 2 provider
    if (TIER2_CASCADE_ORDER.includes(providerMode)) {
      const res = await runSingleTier2Provider(
        providerMode,
        {
          pollinationsPrompt,
          hordePrompt,
          naturalPrompt,
          negativePrompt,
          width,
          height,
          seed,
          aspectRatioId,
          framingMode,
          keys: normalizedKeys,
          models,
          referenceImages,
        },
        { signal, onStatus }
      );
      return Object.assign(res, { elapsedMs: Date.now() - startMs });
    }

    // 2. Hybrid Tier 2 BYOK Auto -> fallback Tier 1 Gratis
    if (providerMode === 'byok_auto') {
      const activeTier2 = TIER2_CASCADE_ORDER.filter((id) => hasKeyForTier2Provider(id, normalizedKeys));
      const errors = [];

      for (const providerId of activeTier2) {
        if (signal && signal.aborted) throw createAbortError();
        try {
          const res = await runSingleTier2Provider(
            providerId,
            {
              pollinationsPrompt,
              hordePrompt,
              naturalPrompt,
              negativePrompt,
              width,
              height,
              seed,
              aspectRatioId,
              framingMode,
              keys: normalizedKeys,
              models,
              referenceImages,
            },
            { signal, onStatus }
          );
          return Object.assign(res, {
            elapsedMs: Date.now() - startMs,
            fallbackReason: errors.length ? errors.join('; ') : '',
          });
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          const shortMsg = sanitizeErrorMessage((err && err.message) || `${providerId} gagal`, 140);
          errors.push(shortMsg);
          emitStatus(onStatus, {
            stage: 'fallback',
            provider: providerId,
            message: `${shortMsg} — mencoba provider berikutnya...`,
          });
        }
      }

      const initialReason = errors.length
        ? errors.join('; ')
        : (activeTier2.length === 0 ? 'Belum ada key Tier 2 terisi' : '');
      const tier1Res = await runTier1Cascade(
        {
          onlyProvider: null,
          pollinationsPrompt,
          hordePrompt,
          negativePrompt,
          width,
          height,
          seed,
          artStyleId,
          hordeApiKey: effectiveHordeKey,
          fallbackReason: initialReason,
        },
        { signal, onStatus }
      );
      return Object.assign(tier1Res, { elapsedMs: Date.now() - startMs });
    }

    // 3. Tier 1 modes ('auto' | 'pollinations' | 'stable_horde')
    const onlyProvider = providerMode === 'auto' ? null : providerMode;
    const tier1Res = await runTier1Cascade(
      {
        onlyProvider,
        pollinationsPrompt,
        hordePrompt,
        negativePrompt,
        width,
        height,
        seed,
        artStyleId,
        hordeApiKey: effectiveHordeKey,
      },
      { signal, onStatus }
    );
    return Object.assign(tier1Res, { elapsedMs: Date.now() - startMs });
  }

  return {
    POLLINATIONS_ENDPOINT,
    POLLINATIONS_GEN_ENDPOINT,
    AI_HORDE_API,
    AI_HORDE_GUEST_KEY,
    GEMINI_API_BASE,
    PIXAZO_ENDPOINTS,
    TOGETHER_ENDPOINT,
    HF_ROUTER_BASE,
    TIER2_MODEL_CATALOG,
    TIER2_CASCADE_ORDER,
    getPollinationsCooldownRemainingSec,
    parseRetryAfterSeconds,
    sanitizeErrorMessage,
    snapDimensions,
    buildPollinationsUrl,
    extractImageFromJsonPayload,
    generatePreview,
  };
});
