/**
 * preview.js - Client-Side Free Image Preview Engine (Tier 1) for Aluna Prompt Studio
 * Adapts the cascading fallback pattern from ffmpeg-ai (Pollinations.ai -> AI Horde)
 * for zero-build browser execution (GitHub Pages & local file:/// usage).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlunaWebImagePreview = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POLLINATIONS_ENDPOINT = 'https://image.pollinations.ai/prompt/';
  const POLLINATIONS_MODELS = ['flux', 'flux-realism'];
  const AI_HORDE_API = 'https://aihorde.net/api/v2';
  const AI_HORDE_GUEST_KEY = '0000000000';
  const AI_HORDE_CLIENT_AGENT = 'AlunaPromptStudioWeb:1.0:github.com/alamaby/online-tools';

  // Default SDXL models verified active on AI Horde; chosen to match steps=25 & k_euler_a
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
  const HORDE_MAX_POLLS = 48; // ~4 minutes max wait before timeout

  // Track IP-level cooldown returned by Pollinations (HTTP 402 FREE_LIMIT / 429)
  let pollinationsCooldownUntil = 0;

  function getPollinationsCooldownRemainingSec() {
    const diff = pollinationsCooldownUntil - Date.now();
    return diff > 0 ? Math.ceil(diff / 1000) : 0;
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

  function sleepWithAbort(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(createAbortError());
        return;
      }
      const timer = setTimeout(() => {
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
        resolve();
      }, ms);

      function onAbort() {
        clearTimeout(timer);
        reject(createAbortError());
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  function createAbortError() {
    const err = new Error('Generasi preview dibatalkan oleh pengguna.');
    err.name = 'AbortError';
    return err;
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

  function buildPollinationsUrl(prompt, { width, height, seed, model }) {
    const encodedPrompt = encodeURIComponent(prompt);
    return (
      `${POLLINATIONS_ENDPOINT}${encodedPrompt}` +
      `?width=${width}&height=${height}&seed=${seed}&nologo=true&model=${encodeURIComponent(model)}`
    );
  }

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

      if (onStatus) {
        onStatus({
          stage: 'pollinations',
          provider: 'pollinations',
          model,
          message: `Menghubungi Pollinations.ai (${model})...`,
        });
      }

      const url = buildPollinationsUrl(prompt, { width, height, seed, model });

      let resp;
      try {
        resp = await fetch(url, { method: 'GET', signal });
      } catch (fetchErr) {
        if (fetchErr && fetchErr.name === 'AbortError') throw fetchErr;
        lastError = fetchErr;
        continue;
      }

      // Pollinations free tier returns HTTP 402 FREE_LIMIT (1 image / 45s per IP) or 429
      if (resp.status === 402 || resp.status === 429) {
        const bodyText = await resp.text().catch(() => '');
        const waitSec = parseRetryAfterSeconds(
          bodyText,
          resp.headers.get('Retry-After')
        );
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

      const objectUrl = URL.createObjectURL(blob);
      return {
        src: objectUrl,
        blob,
        isObjectUrl: true,
        provider: 'pollinations',
        providerLabel: 'Pollinations.ai',
        model,
        width,
        height,
        seed,
        mimeType: blob.type || ct || 'image/jpeg',
      };
    }

    throw lastError || new Error('Pollinations gagal menghasilkan gambar.');
  }

  function base64ToBlob(b64, mimeType = 'image/webp') {
    const clean = b64.includes(',') ? b64.split(',', 2)[1] : b64;
    const binStr = atob(clean);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }

  async function tryAiHorde(
    { prompt, negativePrompt, width, height, seed, artStyleId, apiKey },
    { signal, onStatus } = {}
  ) {
    const key = (apiKey && String(apiKey).trim()) || AI_HORDE_GUEST_KEY;
    const models = pickHordeModels(artStyleId);
    const combinedPrompt = negativePrompt
      ? `${prompt} ### ${negativePrompt}`
      : prompt;

    if (onStatus) {
      onStatus({
        stage: 'horde_submit',
        provider: 'stable_horde',
        message: 'Mengirim job ke antrean AI Horde...',
      });
    }

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
      const errBody = await submitResp.text().catch(() => '');
      throw new Error(
        `AI Horde menolak permintaan (HTTP ${submitResp.status})${errBody ? ': ' + errBody.slice(0, 180) : ''}`
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
        if (onStatus) {
          onStatus({
            stage: 'horde_download',
            provider: 'stable_horde',
            message: 'Mengunduh hasil gambar dari AI Horde...',
          });
        }

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

        if (rawImg.startsWith('http://') || rawImg.startsWith('https://')) {
          return {
            src: rawImg,
            blob: null,
            isObjectUrl: false,
            provider: 'stable_horde',
            providerLabel: 'AI Horde',
            model: usedModel,
            width,
            height,
            seed,
            mimeType: 'image/webp',
          };
        }

        const blob = base64ToBlob(rawImg, 'image/webp');
        const objectUrl = URL.createObjectURL(blob);
        return {
          src: objectUrl,
          blob,
          isObjectUrl: true,
          provider: 'stable_horde',
          providerLabel: 'AI Horde',
          model: usedModel,
          width,
          height,
          seed,
          mimeType: 'image/webp',
        };
      }

      if (onStatus) {
        const qPos = checkData.queue_position ?? '?';
        const waitSec = checkData.wait_time ?? '?';
        onStatus({
          stage: 'horde_queue',
          provider: 'stable_horde',
          queuePosition: qPos,
          waitTime: waitSec,
          message: `Menunggu antrean AI Horde... Posisi #${qPos}, estimasi ~${waitSec}s`,
        });
      }
    }

    throw new Error('Antrean AI Horde melebihi batas waktu tunggu (~4 menit).');
  }

  async function generatePreview(
    {
      providerMode = 'auto',
      pollinationsPrompt,
      hordePrompt,
      negativePrompt = '',
      width = 1024,
      height = 576,
      seed = 42,
      artStyleId = '',
      hordeApiKey = '',
    },
    { signal, onStatus } = {}
  ) {
    const startMs = Date.now();
    let fallbackReason = '';

    if (providerMode === 'pollinations' || providerMode === 'auto') {
      try {
        const res = await tryPollinations(
          { prompt: pollinationsPrompt, width, height, seed },
          { signal, onStatus }
        );
        return Object.assign(res, { elapsedMs: Date.now() - startMs });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        if (providerMode === 'pollinations') throw err;
        fallbackReason = err && err.message ? err.message : 'Pollinations tidak tersedia';
        if (onStatus) {
          onStatus({
            stage: 'fallback',
            provider: 'stable_horde',
            message: `${fallbackReason} — beralih ke AI Horde...`,
          });
        }
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
    return Object.assign(hordeRes, {
      elapsedMs: Date.now() - startMs,
      fallbackReason,
    });
  }

  return {
    POLLINATIONS_ENDPOINT,
    AI_HORDE_API,
    AI_HORDE_GUEST_KEY,
    getPollinationsCooldownRemainingSec,
    parseRetryAfterSeconds,
    buildPollinationsUrl,
    generatePreview,
  };
});
