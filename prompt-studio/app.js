/**
 * app.js - Main Application Controller for Aluna Prompt Studio (Web Edition)
 * Zero external dependencies. Works on modern mobile, tablet, and desktop browsers.
 */

(function () {
  'use strict';

  // Ensure catalog data bundle is loaded
  if (!window.PROMPT_STUDIO_PRESETS) {
    console.error('Fatal: window.PROMPT_STUDIO_PRESETS not found. Check data/data.js.');
    return;
  }

  const presets = window.PROMPT_STUDIO_PRESETS;
  const wardrobe = window.PROMPT_STUDIO_WARDROBE || {};
  const traits = window.PROMPT_STUDIO_TRAITS || {};

  // Initialize Generator Engine
  const generator = new PromptGeneratorEngine.PromptGenerator(presets, wardrobe, traits);

  // Helper DOM selector
  const $ = (id) => document.getElementById(id);

  // App State
  const state = {
    target_engine_id: 'midjourney',
    art_style_id: 'style_semi_realistic_ln',
    aspect_ratio_id: '16:9',
    image_ref_id: 'master_both_ab',
    custom_ref_path: '',
    cw_weight: 80,
    outfit_id: 'uniform_bumimart',
    custom_attire_prompt: '',
    custom_attire_name: '',
    scenery_id: 'bumimart_pos1',
    pose_id: 'pose_sop_greeting',
    lover_profile_id: 'random',
    camera_angle_id: 'medium_shot',
    lighting_id: 'morning_sunbeams',
    include_clan_regalia: true,
    include_aki_bolang: true,
    include_lunar_ward: true,
    spatial_guard: true,
    custom_details: '',
    custom_hair_trait: '',
  };

  // Modular Wardrobe Slots State
  const wardrobeState = {
    inner_top: 'inner_top_none',
    inner_bottom: 'inner_bottom_none',
    outer_top: 'outer_top_bumimart_polo',
    outer_bottom: 'outer_bottom_bumimart_trousers',
    layer_accessory: 'layer_bumimart_vest',
    footwear: 'footwear_bumimart_sneakers',
    inner_visibility: 'hidden',
    slot_colors: {},
  };

  // Character Traits State (Aligned with Canonical Aluna Baseline)
  const traitsState = {
    art_style_id: 'style_semi_realistic_ln',
    hairstyle_id: 'hair_barista_bun',
    hair_color_id: 'color_glossy_raven_black',
    face_shape_id: 'face_oval_delicate',
    skin_complexion_id: 'skin_porcelain_bright',
    eye_type_id: 'eyes_walnut_almond',
    facial_detail_id: 'detail_right_dimple',
    expression_id: 'expr_retail_sop_smile',
    neutral_attire_id: 'attire_fitted_ivory_mockneck',
    shot_type_id: 'shot_turnaround_4views',
    include_clan_regalia: true,
  };

  // Bulk Results Storage
  let lastBulkResults = [];

  // Free Tier 1 Preview State
  const HORDE_KEY_STORAGE = 'aluna_horde_api_key';
  const previewState = {
    isGenerating: false,
    controller: null,
    cooldownTimer: null,
    lastResult: null,
    lastObjectUrl: null,
  };

  function safeStorageGet(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) || '' : '';
    } catch (_) {
      return '';
    }
  }

  function safeStorageSet(key, value) {
    try {
      if (!window.localStorage) return;
      if (value) {
        window.localStorage.setItem(key, value);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch (_) {
      // Ignore storage errors in private / restricted file:/// contexts
    }
  }

  function setPreviewStatus(text, tone = '') {
    const bar = $('preview-status-bar');
    if (!bar) return;
    bar.className = 'preview-status' + (tone ? ` is-${tone}` : '');
    bar.textContent = text;
  }

  function updatePreviewDimensionHint() {
    if (!PromptGeneratorEngine || !PromptGeneratorEngine.getPreviewDimensions) return;
    const dims = PromptGeneratorEngine.getPreviewDimensions(state.aspect_ratio_id);
    const hint = $('preview-dim-hint');
    if (hint) hint.textContent = `${state.aspect_ratio_id} • ${dims.width}×${dims.height}`;
    const emptyDim = $('preview-empty-dim');
    if (emptyDim) emptyDim.textContent = `Dimensi target: ${dims.width} × ${dims.height} px (${state.aspect_ratio_id})`;
  }

  function syncPreviewControls() {
    const genBtn = $('btn-preview-generate');
    const cancelBtn = $('btn-preview-cancel');
    const dlBtn = $('btn-preview-download');
    const providerSel = $('select-preview-provider');
    if (!genBtn || !cancelBtn || !dlBtn) return;

    const previewApi = window.AlunaWebImagePreview;
    const cooldownSec = previewApi ? previewApi.getPollinationsCooldownRemainingSec() : 0;
    const selectedMode = providerSel ? providerSel.value : 'auto';
    const blockedByCooldown = selectedMode === 'pollinations' && cooldownSec > 0;

    genBtn.disabled = previewState.isGenerating || blockedByCooldown;
    if (previewState.isGenerating) {
      genBtn.textContent = '⏳ Memproses...';
    } else if (blockedByCooldown) {
      genBtn.textContent = `⏳ Tunggu ${cooldownSec}s`;
    } else {
      genBtn.textContent = '🎨 Generate Preview';
    }

    cancelBtn.disabled = !previewState.isGenerating;
    dlBtn.disabled = !previewState.lastResult || previewState.isGenerating;
  }

  function ensureCooldownTicker() {
    if (previewState.cooldownTimer) return;
    const previewApi = window.AlunaWebImagePreview;
    if (!previewApi || previewApi.getPollinationsCooldownRemainingSec() <= 0) return;

    previewState.cooldownTimer = setInterval(() => {
      const left = previewApi.getPollinationsCooldownRemainingSec();
      syncPreviewControls();
      if (left <= 0) {
        clearInterval(previewState.cooldownTimer);
        previewState.cooldownTimer = null;
        if (!previewState.isGenerating) {
          setPreviewStatus('Cooldown Pollinations selesai. Siap membuat preview baru.');
        }
      }
    }, 1000);
  }

  async function runWebImagePreview() {
    const previewApi = window.AlunaWebImagePreview;
    if (!previewApi) {
      showToast('Modul preview.js belum termuat.', 'err');
      return;
    }
    if (previewState.isGenerating) return;

    const payloads = generator.buildWebImagePreviewPayloads(state);
    const providerMode = ($('select-preview-provider') && $('select-preview-provider').value) || 'auto';
    const rawSeed = $('input-preview-seed') ? parseInt($('input-preview-seed').value, 10) : NaN;
    const seed = Number.isFinite(rawSeed) && rawSeed >= 0 ? rawSeed : Math.floor(Math.random() * 999999);
    if ($('input-preview-seed')) $('input-preview-seed').value = String(seed);
    const hordeApiKey = ($('input-preview-horde-key') && $('input-preview-horde-key').value.trim()) || '';

    previewState.isGenerating = true;
    previewState.controller = new AbortController();
    syncPreviewControls();
    setPreviewStatus('Menyiapkan payload prompt ringkas...', 'loading');

    try {
      const result = await previewApi.generatePreview(
        {
          providerMode,
          pollinationsPrompt: payloads.pollinationsPrompt,
          hordePrompt: payloads.hordePrompt,
          negativePrompt: payloads.negativePrompt,
          width: payloads.dimensions.width,
          height: payloads.dimensions.height,
          seed,
          artStyleId: state.art_style_id,
          hordeApiKey,
        },
        {
          signal: previewState.controller.signal,
          onStatus: (info) => {
            if (info && info.message) {
              setPreviewStatus(info.message, info.stage === 'fallback' ? 'warn' : 'loading');
            }
          },
        }
      );

      if (previewState.lastObjectUrl && previewState.lastObjectUrl !== result.src) {
        URL.revokeObjectURL(previewState.lastObjectUrl);
        previewState.lastObjectUrl = null;
      }
      if (result.isObjectUrl) {
        previewState.lastObjectUrl = result.src;
      }
      previewState.lastResult = result;

      const imgEl = $('preview-image');
      const emptyEl = $('preview-empty');
      const stageEl = $('preview-stage');
      const metaEl = $('preview-meta');
      const detailsEl = $('preview-prompt-details');
      const sentEl = $('preview-sent-prompt');
      const summaryEl = $('preview-prompt-summary');
      const sentPrompt = result.provider === 'stable_horde'
        ? payloads.hordePrompt
        : payloads.pollinationsPrompt;

      if (imgEl && emptyEl && stageEl) {
        imgEl.src = result.src;
        imgEl.style.display = 'block';
        emptyEl.style.display = 'none';
        stageEl.classList.add('has-image');
      }

      if (detailsEl && sentEl && summaryEl) {
        sentEl.textContent = sentPrompt;
        summaryEl.textContent = `🔍 Lihat Prompt Ringkas yang Dikirim (${sentPrompt.length} karakter)`;
        detailsEl.style.display = 'block';
      }

      if (metaEl) {
        const elapsedMs = result.elapsedMs || 0;
        const secStr = elapsedMs < 150 ? '<0.1s (cache)' : `${(elapsedMs / 1000).toFixed(1)}s`;
        metaEl.innerHTML = '';
        [
          `Provider: <strong>${escapeHtml(result.providerLabel || result.provider)}</strong>`,
          `Model: <strong>${escapeHtml(result.model || '-')}</strong>`,
          `Ukuran: <strong>${result.width}&times;${result.height}</strong>`,
          `Seed: <strong>${result.seed}</strong>`,
          `Waktu: <strong>${secStr}</strong>`,
        ].forEach((chipHtml) => {
          const chip = document.createElement('div');
          chip.className = 'chip';
          chip.innerHTML = chipHtml;
          metaEl.appendChild(chip);
        });
        metaEl.style.display = 'flex';
      }

      const fallbackNote = result.fallbackReason ? ` (Fallback: ${result.fallbackReason})` : '';
      setPreviewStatus(`Preview berhasil dibuat via ${result.providerLabel}${fallbackNote}.`, 'ok');
      showToast(`🎨 Preview siap via ${result.providerLabel}!`, 'ok');
    } catch (err) {
      if (err && err.name === 'AbortError') {
        setPreviewStatus('Generasi preview dibatalkan.', 'warn');
        showToast('Preview dibatalkan.', 'info');
      } else {
        const msg = (err && err.message) ? err.message : 'Gagal membuat preview gambar.';
        setPreviewStatus(msg, 'err');
        showToast(msg, 'err');
      }
    } finally {
      previewState.isGenerating = false;
      previewState.controller = null;
      ensureCooldownTicker();
      syncPreviewControls();
    }
  }

  function cancelWebImagePreview() {
    if (previewState.controller) {
      previewState.controller.abort();
    }
  }

  function downloadPreviewImage() {
    const res = previewState.lastResult;
    if (!res) {
      showToast('Belum ada gambar preview untuk diunduh.', 'err');
      return;
    }
    const ext = (res.mimeType || '').includes('png')
      ? 'png'
      : (res.mimeType || '').includes('webp')
        ? 'webp'
        : 'jpg';
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `aluna_preview_${res.provider || 'free'}_${ts}.${ext}`;

    if (res.blob) {
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 250);
      showToast(`💾 Mengunduh gambar: ${filename}`, 'ok');
    } else if (res.src) {
      window.open(res.src, '_blank', 'noopener,noreferrer');
    }
  }

  // --- Utility: Toast Notification ---
  function showToast(message, type = 'info') {
    const container = $('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'ok' ? '✅' : type === 'err' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 2500);
  }

  // --- Utility: Copy to Clipboard ---
  function copyTextToClipboard(text, successMsg = 'Teks berhasil disalin ke clipboard!') {
    if (!text || !text.trim()) {
      showToast('Tidak ada teks untuk disalin!', 'err');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg, 'ok');
      }).catch(err => {
        fallbackCopy(text, successMsg);
      });
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      showToast(successMsg, 'ok');
    } catch (err) {
      showToast('Gagal menyalin teks ke clipboard.', 'err');
    }
    document.body.removeChild(textArea);
  }

  // --- Utility: Download Markdown File ---
  function downloadMarkdown(filename, content) {
    if (!content || !content.trim()) {
      showToast('Tidak ada konten prompt untuk diunduh!', 'err');
      return;
    }
    const safeName = filename.endsWith('.md') ? filename : `${filename}.md`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
    showToast(`📥 Mengunduh berkas Markdown: ${safeName}`, 'ok');
  }

  // --- Populate Dropdowns ---
  function updateStudioArtStyleDesc(styleId) {
    const el = $('desc-studio-artstyle');
    if (!el) return;
    const style = (traits.art_styles || []).find(s => s.id === styleId);
    if (style) {
      el.textContent = `🎨 ${style.description}`;
    } else {
      el.textContent = '';
    }
  }

  function updateBulkArtStyleDesc(styleId) {
    const el = $('desc-bulk-artstyle');
    if (!el) return;
    const style = (traits.art_styles || []).find(s => s.id === styleId);
    if (style) {
      el.textContent = `💡 ${style.description}`;
    } else {
      el.textContent = '';
    }
  }

  function updateBulkEngineLabel() {
    const el = $('lbl-bulk-engine-name');
    if (!el) return;
    const eng = (presets.target_engines || []).find(e => e.id === state.target_engine_id);
    el.textContent = eng ? eng.name : state.target_engine_id.toUpperCase();
  }

  function populateSelect(selectEl, items, selectedValue, formatFn) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    items.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = formatFn ? formatFn(item) : item.name;
      if (item.id === selectedValue) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  function initDropdowns() {
    // 1. Target Engine
    populateSelect($('select-engine'), presets.target_engines, state.target_engine_id);

    // 2. Aspect Ratio
    populateSelect($('select-ar'), presets.aspect_ratios, state.aspect_ratio_id);

    // 2b. Art Style in Studio Utama
    if ($('select-studio-artstyle')) {
      populateSelect($('select-studio-artstyle'), traits.art_styles, state.art_style_id);
      updateStudioArtStyleDesc(state.art_style_id);
    }

    // 3. Image Reference
    populateSelect($('select-image-ref'), presets.image_references, state.image_ref_id);

    // 4. Outfit Categories & Outfits
    const catSelect = $('select-outfit-category');
    catSelect.innerHTML = '<option value="all">🌟 Semua Kategori (103 Busana)</option>';
    const categories = presets.outfit_categories || {};
    Object.keys(categories).forEach(catId => {
      if (catId === 'all') return;
      const cat = categories[catId];
      const opt = document.createElement('option');
      opt.value = catId;
      opt.textContent = cat.name;
      catSelect.appendChild(opt);
    });
    updateOutfitDropdown('all');

    // 5. Scenery
    populateSelect($('select-scenery'), presets.sceneries, state.scenery_id);

    // 6. Pose
    populateSelect($('select-pose'), presets.poses, state.pose_id);

    // 7. Lover Archetypes
    populateSelect($('select-lover-profile'), presets.lover_archetypes, state.lover_profile_id);

    // 8. Camera Angle (Initial)
    updateCameraAngleDropdown();

    // 9. Lighting
    populateSelect($('select-lighting'), presets.lightings, state.lighting_id);

    // 10. Wardrobe Recipes & Modular Slots
    populateSelect($('select-wardrobe-recipe'), wardrobe.style_recipes, wardrobe.style_recipes[0].id);
    populateSelect($('select-inner-top'), wardrobe.inner_tops, wardrobeState.inner_top);
    populateSelect($('select-inner-bottom'), wardrobe.inner_bottoms, wardrobeState.inner_bottom);
    populateSelect($('select-outer-top'), wardrobe.outer_tops, wardrobeState.outer_top);
    populateSelect($('select-outer-bottom'), wardrobe.outer_bottoms, wardrobeState.outer_bottom);
    populateSelect($('select-layer-acc'), wardrobe.layer_accessories, wardrobeState.layer_accessory);
    populateSelect($('select-footwear'), wardrobe.footwear, wardrobeState.footwear);

    // 11. Character Traits
    populateSelect($('select-trait-artstyle'), traits.art_styles, traitsState.art_style_id);
    populateSelect($('select-trait-hairstyle'), traits.hairstyles, traitsState.hairstyle_id);
    populateSelect($('select-trait-haircolor'), traits.hair_colors, traitsState.hair_color_id);
    populateSelect($('select-trait-expression'), traits.expressions, traitsState.expression_id);
    populateSelect($('select-trait-complexion'), traits.skin_complexions, traitsState.skin_complexion_id);
    populateSelect($('select-trait-faceshape'), traits.face_shapes, traitsState.face_shape_id);
    populateSelect($('select-trait-eyetype'), traits.eye_types, traitsState.eye_type_id);
    populateSelect($('select-trait-detail'), traits.facial_details, traitsState.facial_detail_id);
    populateSelect($('select-trait-shottype'), traits.shot_types, traitsState.shot_type_id);
    populateSelect($('select-trait-attire'), traits.neutral_attires, traitsState.neutral_attire_id);
    syncTraitAttireForHair();

    // Ensure traitsState strictly reflects the selected values in populated dropdowns
    traitsState.art_style_id = $('select-trait-artstyle').value;
    traitsState.hairstyle_id = $('select-trait-hairstyle').value;
    traitsState.hair_color_id = $('select-trait-haircolor').value;
    traitsState.expression_id = $('select-trait-expression').value;
    traitsState.skin_complexion_id = $('select-trait-complexion').value;
    traitsState.face_shape_id = $('select-trait-faceshape').value;
    traitsState.eye_type_id = $('select-trait-eyetype').value;
    traitsState.facial_detail_id = $('select-trait-detail').value;
    traitsState.shot_type_id = $('select-trait-shottype').value;
    traitsState.neutral_attire_id = $('select-trait-attire').value;
    if ($('check-trait-regalia')) {
      traitsState.include_clan_regalia = $('check-trait-regalia').checked;
    }

    // 12. Bulk Vibe & Fitting Categories
    const vibeSelect = $('select-bulk-vibe');
    vibeSelect.innerHTML = '';
    const vibes = presets.thematic_vibes || {};
    Object.keys(vibes).forEach(vibeId => {
      const v = vibes[vibeId];
      const opt = document.createElement('option');
      opt.value = vibeId;
      opt.textContent = `${v.icon || '✨'} ${v.name}`;
      vibeSelect.appendChild(opt);
    });

    const fitCatSelect = $('select-fitting-category');
    fitCatSelect.innerHTML = '<option value="all">🌟 Semua Koleksi (103 Busana Penuh)</option>';
    Object.keys(categories).forEach(catId => {
      if (catId === 'all') return;
      const cat = categories[catId];
      const opt = document.createElement('option');
      opt.value = catId;
      opt.textContent = cat.name;
      fitCatSelect.appendChild(opt);
    });

    // Bulk Art Style & Engine label
    if ($('select-bulk-artstyle')) {
      populateSelect($('select-bulk-artstyle'), traits.art_styles, state.art_style_id);
      updateBulkArtStyleDesc(state.art_style_id);
    }
    updateBulkEngineLabel();
  }

  // --- Dynamic Outfits by Category ---
  function updateOutfitDropdown(categoryId) {
    const outfitSelect = $('select-outfit');
    let items = presets.outfits || [];
    if (categoryId && categoryId !== 'all') {
      items = items.filter(o => o.category === categoryId);
    }
    populateSelect(outfitSelect, items, state.outfit_id);
    if (items.length > 0 && !items.some(o => o.id === state.outfit_id)) {
      state.outfit_id = items[0].id;
      outfitSelect.value = state.outfit_id;
    }
  }

  // --- Bidirectional ⭐ Pairing Matrix ---
  function updateCameraAngleDropdown() {
    const angleSelect = $('select-camera-angle');
    const recAngles = new Set(generator.getRecommendedAnglesForPose(state.pose_id));
    
    angleSelect.innerHTML = '';
    (presets.camera_angles || []).forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.id;
      const isRec = recAngles.has(item.id);
      opt.textContent = `${isRec ? '⭐ ' : ''}${item.name}`;
      if (item.id === state.camera_angle_id) opt.selected = true;
      angleSelect.appendChild(opt);
    });

    updateCompatibilityBadge();
  }

  function updateCompatibilityBadge() {
    const badge = $('pairing-status-badge');
    if (!badge) return;

    const isCompat = generator.isPoseAngleCompatible(state.pose_id, state.camera_angle_id);
    const isVehicle = generator.isVehiclePose(state.pose_id);
    const isValidScenery = generator.isValidVehicleScenery(state.scenery_id);

    if (isVehicle) {
      if (isValidScenery) {
        badge.className = 'compat-badge compat-matched';
        badge.innerHTML = '🏍️ <strong>Latar Kendaraan Sesuai</strong> (Area Luar / Jalan / Parkiran) &bull; ' + (isCompat ? '✨ Angle Sinematik' : '👌 Angle Standar');
      } else {
        badge.className = 'compat-badge compat-flexible';
        badge.innerHTML = '⚠️ <strong>Latar Indoor</strong> (Spatial Guard: Auto-adaptasi ke Area Luar/Parkiran) &bull; ' + (isCompat ? '✨ Angle Sinematik' : '👌 Angle Standar');
      }
    } else {
      if (isCompat) {
        badge.className = 'compat-badge compat-matched';
        badge.innerHTML = '✨ <strong>Komposisi Serasi</strong> (Best Match / Pasangan Sinematik Direkomendasikan)';
      } else {
        badge.className = 'compat-badge compat-flexible';
        badge.innerHTML = '👌 <strong>Komposisi Fleksibel</strong> (Kombinasi Standar / Eksplorasi Bebas)';
      }
    }
  }

  // --- Update Prompt Output & UI ---
  function updatePromptOutput() {
    const gen = generator.generate(state);

    // Main Prompt Box
    const outBox = $('output-prompt-box');
    outBox.textContent = gen.fullPrompt;

    // Negative Prompt Box
    const negSection = $('negative-prompt-section');
    const negBox = $('output-negative-box');
    if (gen.negativePrompt) {
      negSection.style.display = 'block';
      negBox.textContent = gen.negativePrompt;
    } else {
      negSection.style.display = 'none';
      negBox.textContent = '';
    }

    // Metadata Chips
    const chipsContainer = $('meta-chips-container');
    chipsContainer.innerHTML = '';
    const m = gen.metadata;
    const chips = [
      `Engine: <strong>${m.engine}</strong>`,
      `Art Style: <strong>${m.art_style || 'Kanonik'}</strong>`,
      `Rasio: <strong>${m.aspect_ratio}</strong>`,
      `Busana: <strong>${m.outfit}</strong>`,
      `Latar: <strong>${m.scenery}</strong>`,
      `Pose: <strong>${m.pose}</strong>`,
      `Sudut: <strong>${m.camera_angle}</strong>`,
      `Cahaya: <strong>${m.lighting}</strong>`,
    ];
    if (state.spatial_guard && m.spatial_guard.startsWith('Aktif')) {
      chips.push(`<span style="color:var(--gold);">🏍️ Spatial Guard Aktif</span>`);
    }
    chips.forEach(html => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = html;
      chipsContainer.appendChild(chip);
    });

    updatePreviewDimensionHint();
  }

  // --- Quick Roll Functions ---
  function rollCharacter() {
    const outfits = presets.outfits || [];
    const poses = presets.poses || [];
    const angles = presets.camera_angles || [];

    if (outfits.length) state.outfit_id = outfits[Math.floor(Math.random() * outfits.length)].id;
    if (poses.length) state.pose_id = poses[Math.floor(Math.random() * poses.length)].id;
    if (angles.length) state.camera_angle_id = angles[Math.floor(Math.random() * angles.length)].id;

    // Reset modular attire if character randomized
    if (state.custom_attire_prompt) {
      clearModularAttire(false);
    }

    syncStateToInputs();
    updateCameraAngleDropdown();
    updatePromptOutput();
    showToast('🎲 Karakter diacak! (Outfit + Pose + Angle)', 'ok');
  }

  function rollThematicVibe() {
    const vibes = presets.thematic_vibes || {};
    const vibeIds = Object.keys(vibes);
    if (!vibeIds.length) return;

    const randomVibeId = vibeIds[Math.floor(Math.random() * vibeIds.length)];
    const v = vibes[randomVibeId];

    if (v.outfits && v.outfits.length) state.outfit_id = v.outfits[Math.floor(Math.random() * v.outfits.length)];
    if (v.sceneries && v.sceneries.length) state.scenery_id = v.sceneries[Math.floor(Math.random() * v.sceneries.length)];
    if (v.poses && v.poses.length) state.pose_id = v.poses[Math.floor(Math.random() * v.poses.length)];
    if (v.camera_angles && v.camera_angles.length) state.camera_angle_id = v.camera_angles[Math.floor(Math.random() * v.camera_angles.length)];
    if (v.lightings && v.lightings.length) state.lighting_id = v.lightings[Math.floor(Math.random() * v.lightings.length)];

    if (state.custom_attire_prompt) {
      clearModularAttire(false);
    }

    syncStateToInputs();
    updateCameraAngleDropdown();
    updatePromptOutput();
    showToast(`✨ Roll Bertema: ${v.name}`, 'ok');
  }

  function rollTotal() {
    rollCharacter();
    const sceneries = presets.sceneries || [];
    const lightings = presets.lightings || [];
    if (sceneries.length) state.scenery_id = sceneries[Math.floor(Math.random() * sceneries.length)].id;
    if (lightings.length) state.lighting_id = lightings[Math.floor(Math.random() * lightings.length)].id;

    syncStateToInputs();
    updateCameraAngleDropdown();
    updatePromptOutput();
    showToast('🌐 Seluruh parameter diacak!', 'ok');
  }

  function resetForm() {
    state.target_engine_id = 'midjourney';
    state.aspect_ratio_id = '16:9';
    state.image_ref_id = 'master_both_ab';
    state.custom_ref_path = '';
    state.cw_weight = 80;
    state.outfit_id = 'uniform_bumimart';
    state.custom_attire_prompt = '';
    state.custom_attire_name = '';
    state.scenery_id = 'bumimart_pos1';
    state.pose_id = 'pose_sop_greeting';
    state.lover_profile_id = 'random';
    state.camera_angle_id = 'medium_shot';
    state.lighting_id = 'morning_sunbeams';
    state.include_clan_regalia = true;
    state.include_aki_bolang = true;
    state.include_lunar_ward = true;
    state.spatial_guard = true;
    state.custom_details = '';
    state.custom_hair_trait = '';

    $('select-outfit-category').value = 'all';
    updateOutfitDropdown('all');
    clearModularAttire(false);

    syncStateToInputs();
    updateCameraAngleDropdown();
    updatePromptOutput();
    showToast('🔄 Form dikembalikan ke setelan awal.', 'info');
  }

  function syncStateToInputs() {
    // If current selected outfit does not belong to active category filter, reset to 'all'
    const curCat = $('select-outfit-category').value;
    if (curCat !== 'all') {
      const outfitItem = (presets.outfits || []).find(o => o.id === state.outfit_id);
      if (outfitItem && outfitItem.category !== curCat) {
        $('select-outfit-category').value = 'all';
        updateOutfitDropdown('all');
      }
    }

    $('select-engine').value = state.target_engine_id;
    if ($('select-studio-artstyle')) {
      $('select-studio-artstyle').value = state.art_style_id || 'style_semi_realistic_ln';
      updateStudioArtStyleDesc(state.art_style_id || 'style_semi_realistic_ln');
    }
    $('select-ar').value = state.aspect_ratio_id;
    $('select-image-ref').value = state.image_ref_id;
    $('input-custom-ref').value = state.custom_ref_path;
    $('select-outfit').value = state.outfit_id;
    $('select-scenery').value = state.scenery_id;
    $('select-pose').value = state.pose_id;
    $('select-lover-profile').value = state.lover_profile_id;
    $('select-camera-angle').value = state.camera_angle_id;
    $('select-lighting').value = state.lighting_id;
    $('check-regalia').checked = state.include_clan_regalia;
    $('check-bolang').checked = state.include_aki_bolang;
    $('check-lunar').checked = state.include_lunar_ward;
    $('check-spatial').checked = state.spatial_guard;
    $('input-custom-details').value = state.custom_details;

    // Check duo pose lover profile visibility
    const isDuo = state.pose_id.startsWith('pose_duo_') || state.pose_id.includes('lover');
    $('group-lover-profile').style.display = isDuo ? 'block' : 'none';
  }

  // --- Modular Wardrobe Handlers ---
  function syncColorSelect(slotName, pieceId, selectElId) {
    const el = $(selectElId);
    if (!el) return;
    const piece = (wardrobe.inner_tops || []).find(p => p.id === pieceId) ||
      (wardrobe.inner_bottoms || []).find(p => p.id === pieceId) ||
      (wardrobe.outer_tops || []).find(p => p.id === pieceId) ||
      (wardrobe.outer_bottoms || []).find(p => p.id === pieceId);

    if (piece && piece.color_palette) {
      const palette = (wardrobe.color_palettes || {})[piece.color_palette] || [];
      el.style.display = 'block';
      el.innerHTML = '';
      palette.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `🎨 ${c.name}`;
        el.appendChild(opt);
      });
      const curColor = wardrobeState.slot_colors[slotName] || piece.default_color_id || (palette[0] && palette[0].id);
      el.value = curColor;
      wardrobeState.slot_colors[slotName] = curColor;
    } else {
      el.style.display = 'none';
      delete wardrobeState.slot_colors[slotName];
    }
  }

  function updateModularPreview() {
    syncColorSelect('inner_top', wardrobeState.inner_top, 'select-color-inner-top');
    syncColorSelect('inner_bottom', wardrobeState.inner_bottom, 'select-color-inner-bottom');
    syncColorSelect('outer_top', wardrobeState.outer_top, 'select-color-outer-top');
    syncColorSelect('outer_bottom', wardrobeState.outer_bottom, 'select-color-outer-bottom');

    const synth = generator.synthesizeModularAttire(wardrobeState, wardrobeState.inner_visibility);
    $('wardrobe-summary-text').textContent = synth.summaryText || 'Tanpa busana modular.';
    $('wardrobe-prompt-text').textContent = synth.promptText || '-';
  }

  function applyWardrobeRecipe(recipeId) {
    const recipe = (wardrobe.style_recipes || []).find(r => r.id === recipeId);
    if (!recipe || !recipe.slots) return;

    wardrobeState.inner_top = recipe.slots.inner_top || 'inner_top_none';
    wardrobeState.inner_bottom = recipe.slots.inner_bottom || 'inner_bottom_none';
    wardrobeState.outer_top = recipe.slots.outer_top || 'outer_top_none';
    wardrobeState.outer_bottom = recipe.slots.outer_bottom || 'outer_bottom_none';
    wardrobeState.layer_accessory = recipe.slots.layer_accessory || 'layer_none';
    wardrobeState.footwear = recipe.slots.footwear || 'footwear_bumimart_sneakers';
    wardrobeState.inner_visibility = recipe.slots.inner_visibility || 'hidden';

    $('select-inner-top').value = wardrobeState.inner_top;
    $('select-inner-bottom').value = wardrobeState.inner_bottom;
    $('select-outer-top').value = wardrobeState.outer_top;
    $('select-outer-bottom').value = wardrobeState.outer_bottom;
    $('select-layer-acc').value = wardrobeState.layer_accessory;
    $('select-footwear').value = wardrobeState.footwear;
    $('select-inner-visibility').value = wardrobeState.inner_visibility;

    updateModularPreview();
    showToast(`👗 Resep diterapkan: ${recipe.name}`, 'ok');
  }

  function clearModularAttire(notify = true) {
    state.custom_attire_prompt = '';
    state.custom_attire_name = '';
    $('modular-active-badge').style.display = 'none';
    $('select-outfit').disabled = false;
    $('select-outfit-category').disabled = false;
    updatePromptOutput();
    if (notify) showToast('Busana modular dilepas. Kembali ke katalog outfit.', 'info');
  }

  // --- Character Traits Handlers ---
  function syncTraitAttireForHair() {
    const curHairId = $('select-trait-hairstyle').value;
    const hairObj = (traits.hairstyles || []).find(x => x.id === curHairId);
    const isHijab = hairObj && hairObj.extra && hairObj.extra.is_hijab;
    let availAttires = traits.neutral_attires || [];
    if (isHijab) {
      availAttires = availAttires.filter(a => a.extra && a.extra.modest_compatible);
    }
    const curAttire = $('select-trait-attire').value;
    populateSelect($('select-trait-attire'), availAttires, curAttire);
    if (!availAttires.some(a => a.id === $('select-trait-attire').value)) {
      if (availAttires.length > 0) {
        $('select-trait-attire').value = availAttires[0].id;
        traitsState.neutral_attire_id = availAttires[0].id;
      }
    } else {
      traitsState.neutral_attire_id = $('select-trait-attire').value;
    }
  }

  function updateTraitPromptPreview() {
    const res = generator.buildCharacterExplorationPrompt(traitsState);
    $('trait-prompt-preview').textContent = res.promptText;
  }

  // --- Bulk Vibe & Fitting Room Handlers ---
  function runBulkGeneration() {
    const mode = $('select-bulk-mode').value;
    const resultsArea = $('bulk-results-area');
    const itemsContainer = $('bulk-items-container');
    const titleEl = $('bulk-results-title');

    resultsArea.style.display = 'block';
    itemsContainer.innerHTML = '';

    if (mode === 'vibe') {
      const vibeId = $('select-bulk-vibe').value;
      const count = parseInt($('select-bulk-count').value, 10) || 5;
      const bulkArtStyleId = ($('select-bulk-artstyle') && $('select-bulk-artstyle').value) ? $('select-bulk-artstyle').value : (state.art_style_id || 'style_semi_realistic_ln');

      const locks = {
        lock_art_style: $('check-lock-art-style') ? $('check-lock-art-style').checked : true,
        locked_art_style_id: bulkArtStyleId,

        lock_outfit: $('check-lock-outfit').checked,
        locked_outfit_id: state.outfit_id,
        locked_custom_prompt: state.custom_attire_prompt,
        locked_custom_name: state.custom_attire_name,

        lock_pose: $('check-lock-pose').checked,
        locked_pose_id: state.pose_id,

        lock_scenery: $('check-lock-scenery').checked,
        locked_scenery_id: state.scenery_id,

        lock_camera_angle: $('check-lock-angle').checked,
        locked_camera_angle_id: state.camera_angle_id,

        lock_lighting: $('check-lock-lighting') ? $('check-lock-lighting').checked : false,
        locked_lighting_id: state.lighting_id,
      };

      const baseCfg = Object.assign({}, state, { art_style_id: bulkArtStyleId });
      const results = generator.generateBulk(vibeId, count, baseCfg, locks);
      lastBulkResults = results;
      titleEl.textContent = `Hasil Bulk Vibe: ${count} Prompt Unik`;

      results.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'bulk-item-card';
        card.innerHTML = `
          <div class="bulk-header">
            <span><strong>Prompt #${index + 1}</strong> &bull; ${item.metadata.outfit} &bull; ${item.metadata.scenery} &bull; ${item.metadata.pose}</span>
            <button class="btn btn-outline btn-sm btn-copy-single" data-index="${index}">📋 Salin</button>
          </div>
          <div class="bulk-pre">${escapeHtml(item.fullPrompt)}</div>
        `;
        itemsContainer.appendChild(card);
      });

      showToast(`⚡ Berhasil menyusun ${results.length} prompt bertema!`, 'ok');
    } else {
      // Virtual Fitting Room
      const cat = $('select-fitting-category').value;
      const bulkArtStyleId = ($('select-bulk-artstyle') && $('select-bulk-artstyle').value) ? $('select-bulk-artstyle').value : (state.art_style_id || 'style_semi_realistic_ln');
      const baseCfg = Object.assign({}, state, { art_style_id: bulkArtStyleId });
      const results = generator.generateOutfitMatrix(
        state.pose_id,
        state.scenery_id,
        state.camera_angle_id,
        state.lighting_id,
        baseCfg,
        cat
      );
      lastBulkResults = results;
      titleEl.textContent = `Hasil Virtual Fitting Room: ${results.length} Variasi Busana (Ceteris Paribus)`;

      results.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'bulk-item-card';
        card.innerHTML = `
          <div class="bulk-header">
            <span><strong>#${index + 1}</strong> &bull; ${item.outfitItem ? item.outfitItem.name : item.metadata.outfit}</span>
            <button class="btn btn-outline btn-sm btn-copy-single" data-index="${index}">📋 Salin</button>
          </div>
          <div class="bulk-pre">${escapeHtml(item.fullPrompt)}</div>
        `;
        itemsContainer.appendChild(card);
      });

      showToast(`👗 Virtual Fitting Room: ${results.length} busana dievaluasi!`, 'ok');
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function copyAllBulk() {
    if (!lastBulkResults.length) {
      showToast('Belum ada batch prompt yang dibuat!', 'err');
      return;
    }
    const combined = lastBulkResults.map((item, i) => `### Prompt #${i + 1} - ${item.metadata.outfit}\n\n\`\`\`\n${item.fullPrompt}\n\`\`\``).join('\n\n---\n\n');
    copyTextToClipboard(combined, `Seluruh ${lastBulkResults.length} batch prompt berhasil disalin!`);
  }

  // --- Helper: Download Active Studio Prompt as Markdown ---
  function downloadActivePromptMarkdown() {
    const gen = generator.generate(state);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const humanDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    let md = `# 🧙‍♀️ Aluna Prompt — Snapshot\n\n`;
    md += `**Waktu Generasi:** ${humanDate} | **Engine:** ${gen.metadata.engine.toUpperCase()} | **Aspek Rasio:** ${gen.metadata.aspect_ratio}\n`;
    md += `**Gaya Seni (Art Style):** ${gen.metadata.art_style || 'Semi-Realistic Anime Light Novel'}\n`;
    md += `**Image Reference:** ${gen.metadata.image_reference} (--cw ${gen.metadata.cw_weight})\n`;
    md += `**Busana:** ${gen.metadata.outfit}\n`;
    md += `**Latar:** ${gen.metadata.scenery}\n`;
    md += `**Pose:** ${gen.metadata.pose}\n`;
    if (state.pose_id.startsWith('pose_duo_') || state.pose_id.includes('lover')) {
      md += `**Profil Mature Lover:** ${gen.metadata.lover_profile}\n`;
    }
    md += `**Sudut Kamera:** ${gen.metadata.camera_angle} | **Tata Cahaya:** ${gen.metadata.lighting}\n`;
    md += `**Elemen Kanon:** Aki Bolang: ${gen.metadata.aki_bolang} | Pusaka Arcana: ${gen.metadata.clan_regalia} | Lunar Ward: ${gen.metadata.lunar_ward}\n`;
    if (gen.metadata.spatial_guard.startsWith('Aktif')) {
      md += `**Spatial Guard:** ${gen.metadata.spatial_guard}\n`;
    }
    if (gen.metadata.custom_details && gen.metadata.custom_details !== '-') {
      md += `**Detail Tambahan:** ${gen.metadata.custom_details}\n`;
    }
    md += `\n> Prompt visual karakter Aluna Arundati Buana dihasilkan melalui Aluna Prompt Studio (Web Edition).\n\n`;

    md += `## 📋 Teks Prompt Utama\n\n`;
    md += `\`\`\`text\n${gen.fullPrompt}\n\`\`\`\n\n`;

    if (gen.negativePrompt) {
      md += `## 🚫 Negative Prompt\n\n`;
      md += `\`\`\`text\n${gen.negativePrompt}\n\`\`\`\n\n`;
    }

    const filename = `aluna_prompt_${timestamp}.md`;
    downloadMarkdown(filename, md);
  }

  // --- Helper: Download Modular Wardrobe as Markdown ---
  function downloadModularWardrobeMarkdown() {
    const synth = generator.synthesizeModularAttire(wardrobeState, wardrobeState.inner_visibility);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const humanDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    let md = `# 👗 Aluna Modular Wardrobe Ensemble\n\n`;
    md += `**Waktu Racikan:** ${humanDate}\n`;
    md += `**Visibilitas Dalaman:** ${wardrobeState.inner_visibility}\n\n`;

    md += `## 📦 Rincian 6 Lapisan Modular\n\n`;
    md += `- **Inner Top:** ${$('select-inner-top').options[$('select-inner-top').selectedIndex]?.text || wardrobeState.inner_top}\n`;
    md += `- **Inner Bottom:** ${$('select-inner-bottom').options[$('select-inner-bottom').selectedIndex]?.text || wardrobeState.inner_bottom}\n`;
    md += `- **Outer Top:** ${$('select-outer-top').options[$('select-outer-top').selectedIndex]?.text || wardrobeState.outer_top}\n`;
    md += `- **Outer Bottom:** ${$('select-outer-bottom').options[$('select-outer-bottom').selectedIndex]?.text || wardrobeState.outer_bottom}\n`;
    md += `- **Layer & Aksesoris:** ${$('select-layer-acc').options[$('select-layer-acc').selectedIndex]?.text || wardrobeState.layer_accessory}\n`;
    md += `- **Footwear:** ${$('select-footwear').options[$('select-footwear').selectedIndex]?.text || wardrobeState.footwear}\n\n`;

    md += `## 📝 Ringkasan Busana\n`;
    md += `> ${synth.summaryText}\n\n`;

    md += `## 🇬🇧 Teks Deskripsi Prompt Busana (English)\n\n`;
    md += `\`\`\`text\n${synth.promptText}\n\`\`\`\n\n`;

    const filename = `modular_attire_${timestamp}.md`;
    downloadMarkdown(filename, md);
  }

  // --- Helper: Download Character Trait Profile as Markdown ---
  function downloadCharacterTraitMarkdown() {
    const res = generator.buildCharacterExplorationPrompt(traitsState);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const humanDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    let md = `# 🧙‍♀️ Aluna Character Physical Reference Profile\n\n`;
    md += `**Waktu Eksplorasi:** ${humanDate}\n\n`;

    md += `## 🧬 Profil Sifat Fisik Terpilih\n\n`;
    md += `- **Gaya Rambut:** ${$('select-trait-hairstyle').options[$('select-trait-hairstyle').selectedIndex]?.text || traitsState.hairstyle_id}\n`;
    md += `- **Warna Rambut:** ${$('select-trait-haircolor').options[$('select-trait-haircolor').selectedIndex]?.text || traitsState.hair_color_id}\n`;
    md += `- **Ekspresi Wajah:** ${$('select-trait-expression').options[$('select-trait-expression').selectedIndex]?.text || traitsState.expression_id}\n`;
    md += `- **Rona Kulit:** ${$('select-trait-complexion').options[$('select-trait-complexion').selectedIndex]?.text || traitsState.skin_complexion_id}\n`;
    md += `- **Bentuk Wajah:** ${$('select-trait-faceshape').options[$('select-trait-faceshape').selectedIndex]?.text || traitsState.face_shape_id}\n`;
    md += `- **Bentuk Mata:** ${$('select-trait-eyetype').options[$('select-trait-eyetype').selectedIndex]?.text || traitsState.eye_type_id}\n`;
    md += `- **Detail Wajah:** ${$('select-trait-detail').options[$('select-trait-detail').selectedIndex]?.text || traitsState.facial_detail_id}\n`;
    md += `- **Framing Shot:** ${$('select-trait-shottype').options[$('select-trait-shottype').selectedIndex]?.text || traitsState.shot_type_id}\n`;
    md += `- **Busana Netral:** ${$('select-trait-attire').options[$('select-trait-attire').selectedIndex]?.text || traitsState.neutral_attire_id}\n`;
    md += `- **Pusaka Klan Arcana:** ${traitsState.include_clan_regalia !== false ? 'Ya (Sertakan 4 Pusaka)' : 'Tidak (Dilepas / Tanpa Pusaka)'}\n\n`;

    md += `## 📋 Prompt Potret Acuan Karakter\n\n`;
    md += `\`\`\`text\n${res.promptText}\n\`\`\`\n\n`;

    const filename = `character_reference_${timestamp}.md`;
    downloadMarkdown(filename, md);
  }

  function downloadBulkMarkdown() {
    if (!lastBulkResults.length) {
      showToast('Belum ada batch prompt yang dibuat!', 'err');
      return;
    }
    const mode = $('select-bulk-mode').value;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const humanDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    let md = '';
    let filename = '';

    if (mode === 'vibe') {
      const vibeId = $('select-bulk-vibe').value;
      const vibeName = $('select-bulk-vibe').options[$('select-bulk-vibe').selectedIndex]?.text || vibeId;
      const bulkArtStyleName = (lastBulkResults[0] && lastBulkResults[0].metadata && lastBulkResults[0].metadata.art_style) ? lastBulkResults[0].metadata.art_style : 'Semi-Realistic Anime Light Novel';
      filename = `bulk_${vibeId}_${timestamp}.md`;

      md += `# 📦 Bulk Thematic Vibe: ${vibeName}\n\n`;
      md += `**Waktu Generasi:** ${humanDate} | **Total Prompt:** ${lastBulkResults.length}\n`;
      md += `**Engine:** ${state.target_engine_id.toUpperCase()} | **Aspek Rasio:** ${state.aspect_ratio_id} | **Art Style:** ${bulkArtStyleName}\n\n`;
      md += `> Batch prompt Aluna Prompt Studio dihasilkan dengan jaminan anti-duplikasi kombinasi (*sampling without replacement*).\n\n`;

      md += `## 📋 Indeks Prompt dalam Batch:\n\n`;
      lastBulkResults.forEach((item, i) => {
        md += `${i + 1}. **${item.metadata.outfit}** — *${item.metadata.scenery}* | *${item.metadata.pose}*\n`;
      });
      md += `\n---\n\n`;

      lastBulkResults.forEach((item, i) => {
        md += `### Prompt #${i + 1}: ${item.metadata.outfit}\n\n`;
        md += `- **Gaya Seni (Art Style)**: ${item.metadata.art_style || 'Kanonik'}\n`;
        md += `- **Latar**: ${item.metadata.scenery}\n`;
        md += `- **Pose**: ${item.metadata.pose}\n`;
        md += `- **Kamera**: ${item.metadata.camera_angle}\n`;
        md += `- **Pencahayaan**: ${item.metadata.lighting}\n\n`;
        md += `\`\`\`text\n${item.fullPrompt}\n\`\`\`\n\n`;
        if (item.negativePrompt) {
          md += `**Negative Prompt**:\n\`\`\`text\n${item.negativePrompt}\n\`\`\`\n\n`;
        }
        md += `---\n\n`;
      });
    } else {
      // Virtual Fitting Room
      const bulkArtStyleName = (lastBulkResults[0] && lastBulkResults[0].metadata && lastBulkResults[0].metadata.art_style) ? lastBulkResults[0].metadata.art_style : 'Semi-Realistic Anime Light Novel';
      filename = `fitting_room_${state.pose_id}_${state.scenery_id}_${timestamp}.md`;
      md += `# 👗 Virtual Fitting Room: Komparasi Busana Aluna (${lastBulkResults.length} Outfits)\n\n`;
      md += `**Waktu Generasi:** ${humanDate} | **Engine:** ${state.target_engine_id.toUpperCase()} | **Aspek Rasio:** ${state.aspect_ratio_id}\n`;
      md += `**🔒 Gaya Seni Tetap:** ${bulkArtStyleName}\n`;
      md += `**🔒 Pose Tetap:** ${$('select-pose').options[$('select-pose').selectedIndex]?.text || state.pose_id}\n`;
      md += `**🔒 Latar Tetap:** ${$('select-scenery').options[$('select-scenery').selectedIndex]?.text || state.scenery_id}\n`;
      md += `**🔒 Kamera & Cahaya:** ${$('select-camera-angle').options[$('select-camera-angle').selectedIndex]?.text || state.camera_angle_id} | ${$('select-lighting').options[$('select-lighting').selectedIndex]?.text || state.lighting_id}\n`;
      md += `**Elemen Kanon:** Aki Bolang: ${state.include_aki_bolang ? 'Ya' : 'Tidak'} | Pusaka: ${state.include_clan_regalia ? 'Ya' : 'Tidak'} | Lunar Ward: ${state.include_lunar_ward ? 'Ya' : 'Tidak'}\n\n`;
      md += `> Matriks komparasi busana Aluna Prompt Studio (*Virtual Fitting Room*). Semua parameter dikunci konstan (*ceteris paribus*) untuk mengevaluasi kecocokan dan harmoni visual setiap busana terhadap pose dan latar terpilih.\n\n`;

      md += `## 📋 Daftar Busana dalam Matriks:\n\n`;
      lastBulkResults.forEach((item, i) => {
        const outName = item.outfitItem ? item.outfitItem.name : item.metadata.outfit;
        md += `${i + 1}. **${outName}**\n`;
      });
      md += `\n---\n\n`;

      lastBulkResults.forEach((item, i) => {
        const outName = item.outfitItem ? item.outfitItem.name : item.metadata.outfit;
        md += `### ${i + 1}. ${outName}\n\n`;
        md += `\`\`\`text\n${item.fullPrompt}\n\`\`\`\n\n`;
        if (item.negativePrompt) {
          md += `**Negative Prompt**:\n\`\`\`text\n${item.negativePrompt}\n\`\`\`\n\n`;
        }
        md += `---\n\n`;
      });
    }

    downloadMarkdown(filename, md);
  }

  // --- Tab Switching Logic ---
  function updateContextualBars(activeTabId) {
    document.querySelectorAll('.quick-bar-tab').forEach(el => {
      el.style.display = (el.getAttribute('data-tab') === activeTabId) ? 'flex' : 'none';
    });
    document.querySelectorAll('.mobile-bar-tab').forEach(el => {
      el.style.display = (el.getAttribute('data-tab') === activeTabId) ? 'flex' : 'none';
    });
  }

  function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        const pane = $(targetId);
        if (pane) pane.classList.add('active');
        updateContextualBars(targetId);
      });
    });
    updateContextualBars('tab-studio');
  }

  // --- Event Bindings ---
  function bindEvents() {
    // Dropdown changes in Studio Utama
    $('select-engine').addEventListener('change', (e) => {
      state.target_engine_id = e.target.value;
      updateBulkEngineLabel();
      updatePromptOutput();
    });
    $('select-ar').addEventListener('change', (e) => {
      state.aspect_ratio_id = e.target.value;
      updatePromptOutput();
    });
    if ($('select-studio-artstyle')) {
      $('select-studio-artstyle').addEventListener('change', (e) => {
        state.art_style_id = e.target.value;
        updateStudioArtStyleDesc(e.target.value);
        if ($('select-bulk-artstyle')) {
          $('select-bulk-artstyle').value = e.target.value;
          updateBulkArtStyleDesc(e.target.value);
        }
        updatePromptOutput();
      });
    }
    if ($('select-bulk-artstyle')) {
      $('select-bulk-artstyle').addEventListener('change', (e) => {
        updateBulkArtStyleDesc(e.target.value);
      });
    }
    $('select-image-ref').addEventListener('change', (e) => {
      state.image_ref_id = e.target.value;
      updatePromptOutput();
    });
    $('input-custom-ref').addEventListener('input', (e) => {
      state.custom_ref_path = e.target.value;
      updatePromptOutput();
    });

    $('select-outfit-category').addEventListener('change', (e) => {
      updateOutfitDropdown(e.target.value);
      updatePromptOutput();
    });
    $('select-outfit').addEventListener('change', (e) => {
      state.outfit_id = e.target.value;
      updatePromptOutput();
    });

    $('select-scenery').addEventListener('change', (e) => {
      state.scenery_id = e.target.value;
      updateCompatibilityBadge();
      updatePromptOutput();
    });

    $('select-pose').addEventListener('change', (e) => {
      state.pose_id = e.target.value;
      const isDuo = state.pose_id.startsWith('pose_duo_') || state.pose_id.includes('lover');
      $('group-lover-profile').style.display = isDuo ? 'block' : 'none';
      updateCameraAngleDropdown();
      updatePromptOutput();
    });

    $('select-lover-profile').addEventListener('change', (e) => {
      state.lover_profile_id = e.target.value;
      updatePromptOutput();
    });

    $('select-camera-angle').addEventListener('change', (e) => {
      state.camera_angle_id = e.target.value;
      updateCompatibilityBadge();
      updatePromptOutput();
    });

    $('select-lighting').addEventListener('change', (e) => {
      state.lighting_id = e.target.value;
      updatePromptOutput();
    });

    $('check-regalia').addEventListener('change', (e) => {
      state.include_clan_regalia = e.target.checked;
      updatePromptOutput();
    });
    $('check-bolang').addEventListener('change', (e) => {
      state.include_aki_bolang = e.target.checked;
      updatePromptOutput();
    });
    $('check-lunar').addEventListener('change', (e) => {
      state.include_lunar_ward = e.target.checked;
      updatePromptOutput();
    });
    $('check-spatial').addEventListener('change', (e) => {
      state.spatial_guard = e.target.checked;
      updateCompatibilityBadge();
      updatePromptOutput();
    });
    $('input-custom-details').addEventListener('input', (e) => {
      state.custom_details = e.target.value;
      updatePromptOutput();
    });

    // Quick Action Bar Buttons (Studio Utama)
    $('btn-quick-roll-character').addEventListener('click', rollCharacter);
    $('btn-quick-roll-vibe').addEventListener('click', rollThematicVibe);
    $('btn-quick-roll-total').addEventListener('click', rollTotal);
    $('btn-quick-generate').addEventListener('click', updatePromptOutput);
    $('btn-quick-copy').addEventListener('click', () => copyTextToClipboard($('output-prompt-box').textContent));
    $('btn-quick-download').addEventListener('click', downloadActivePromptMarkdown);
    $('btn-quick-reset').addEventListener('click', resetForm);

    // Mobile Bottom Bar Buttons (Studio Utama)
    $('btn-m-roll-char').addEventListener('click', rollCharacter);
    $('btn-m-roll-vibe').addEventListener('click', rollThematicVibe);
    $('btn-m-generate').addEventListener('click', updatePromptOutput);
    $('btn-m-copy').addEventListener('click', () => copyTextToClipboard($('output-prompt-box').textContent));
    $('btn-m-download').addEventListener('click', downloadActivePromptMarkdown);

    // Contextual Quick & Mobile Buttons (Wardrobe Modular)
    $('btn-quick-wardrobe-random').addEventListener('click', () => $('btn-random-wardrobe').click());
    $('btn-m-wardrobe-random').addEventListener('click', () => $('btn-random-wardrobe').click());
    $('btn-quick-wardrobe-match').addEventListener('click', () => $('btn-match-set-colors').click());
    $('btn-quick-wardrobe-apply').addEventListener('click', () => $('btn-use-modular-in-studio').click());
    $('btn-m-wardrobe-apply').addEventListener('click', () => $('btn-use-modular-in-studio').click());
    $('btn-quick-wardrobe-copy').addEventListener('click', () => copyTextToClipboard($('wardrobe-prompt-text').textContent, 'Teks busana modular disalin!'));
    $('btn-m-wardrobe-copy').addEventListener('click', () => copyTextToClipboard($('wardrobe-prompt-text').textContent, 'Teks busana modular disalin!'));
    $('btn-quick-wardrobe-download').addEventListener('click', downloadModularWardrobeMarkdown);
    $('btn-m-wardrobe-download').addEventListener('click', downloadModularWardrobeMarkdown);
    $('btn-quick-wardrobe-clear').addEventListener('click', () => clearModularAttire(true));

    // Contextual Quick & Mobile Buttons (Explore Karakter)
    $('btn-quick-traits-random').addEventListener('click', () => $('btn-random-traits').click());
    $('btn-m-traits-random').addEventListener('click', () => $('btn-random-traits').click());
    $('btn-quick-traits-apply').addEventListener('click', () => $('btn-apply-hair-to-studio').click());
    $('btn-m-traits-apply').addEventListener('click', () => $('btn-apply-hair-to-studio').click());
    $('btn-quick-traits-copy').addEventListener('click', () => copyTextToClipboard($('trait-prompt-preview').textContent, 'Prompt potret acuan disalin!'));
    $('btn-m-traits-copy').addEventListener('click', () => copyTextToClipboard($('trait-prompt-preview').textContent, 'Prompt potret acuan disalin!'));
    $('btn-quick-traits-download').addEventListener('click', downloadCharacterTraitMarkdown);
    $('btn-m-traits-download').addEventListener('click', downloadCharacterTraitMarkdown);

    // Contextual Quick & Mobile Buttons (Bulk Vibe & Fitting Room)
    $('btn-quick-bulk-run').addEventListener('click', runBulkGeneration);
    $('btn-m-bulk-run').addEventListener('click', runBulkGeneration);
    $('btn-quick-bulk-copy').addEventListener('click', copyAllBulk);
    $('btn-m-bulk-copy').addEventListener('click', copyAllBulk);
    $('btn-quick-bulk-download').addEventListener('click', downloadBulkMarkdown);
    $('btn-m-bulk-download').addEventListener('click', downloadBulkMarkdown);

    // Studio Buttons
    $('btn-copy-prompt').addEventListener('click', () => copyTextToClipboard($('output-prompt-box').textContent));
    $('btn-copy-negative').addEventListener('click', () => copyTextToClipboard($('output-negative-box').textContent, 'Negative prompt disalin!'));
    $('btn-reset-form').addEventListener('click', resetForm);
    $('btn-clear-modular').addEventListener('click', () => clearModularAttire(true));
    $('btn-goto-modular').addEventListener('click', () => {
      document.querySelector('[data-tab="tab-wardrobe"]').click();
    });
    $('btn-export-md').addEventListener('click', downloadActivePromptMarkdown);

    // Free Tier 1 Preview Events
    if ($('btn-preview-generate')) {
      $('btn-preview-generate').addEventListener('click', runWebImagePreview);
    }
    if ($('btn-preview-cancel')) {
      $('btn-preview-cancel').addEventListener('click', cancelWebImagePreview);
    }
    if ($('btn-preview-download')) {
      $('btn-preview-download').addEventListener('click', downloadPreviewImage);
    }
    if ($('btn-preview-random-seed')) {
      $('btn-preview-random-seed').addEventListener('click', () => {
        if ($('input-preview-seed')) {
          $('input-preview-seed').value = String(Math.floor(Math.random() * 999999) + 1);
        }
      });
    }
    if ($('select-preview-provider')) {
      $('select-preview-provider').addEventListener('change', syncPreviewControls);
    }
    if ($('input-preview-horde-key')) {
      $('input-preview-horde-key').addEventListener('input', (e) => {
        safeStorageSet(HORDE_KEY_STORAGE, e.target.value.trim());
      });
    }
    if ($('btn-preview-clear-horde-key')) {
      $('btn-preview-clear-horde-key').addEventListener('click', () => {
        if ($('input-preview-horde-key')) $('input-preview-horde-key').value = '';
        safeStorageSet(HORDE_KEY_STORAGE, '');
        showToast('AI Horde API key lokal dihapus.', 'info');
      });
    }

    // Modular Wardrobe Events
    $('select-wardrobe-recipe').addEventListener('change', (e) => applyWardrobeRecipe(e.target.value));
    $('btn-apply-recipe').addEventListener('click', () => applyWardrobeRecipe($('select-wardrobe-recipe').value));

    ['inner-top', 'inner-bottom', 'outer-top', 'outer-bottom', 'layer-acc', 'footwear'].forEach(slot => {
      const key = slot.replace('-', '_');
      $(`select-${slot}`).addEventListener('change', (e) => {
        wardrobeState[key] = e.target.value;
        updateModularPreview();
      });
    });

    // Modular Color Change Events
    ['inner-top', 'inner-bottom', 'outer-top', 'outer-bottom'].forEach(slot => {
      const key = slot.replace('-', '_');
      const el = $(`select-color-${slot}`);
      if (el) {
        el.addEventListener('change', (e) => {
          wardrobeState.slot_colors[key] = e.target.value;
          updateModularPreview();
        });
      }
    });

    $('btn-match-set-colors').addEventListener('click', () => {
      let matched = false;
      const itPiece = (wardrobe.inner_tops || []).find(p => p.id === wardrobeState.inner_top);
      const ibPiece = (wardrobe.inner_bottoms || []).find(p => p.id === wardrobeState.inner_bottom);
      if (itPiece && ibPiece && itPiece.color_palette && ibPiece.color_palette) {
        const itColor = wardrobeState.slot_colors.inner_top || itPiece.default_color_id;
        const palette = (wardrobe.color_palettes || {})[ibPiece.color_palette] || [];
        if (palette.some(c => c.id === itColor)) {
          wardrobeState.slot_colors.inner_bottom = itColor;
          const el = $('select-color-inner-bottom');
          if (el) el.value = itColor;
          matched = true;
        }
      }

      const otPiece = (wardrobe.outer_tops || []).find(p => p.id === wardrobeState.outer_top);
      const obPiece = (wardrobe.outer_bottoms || []).find(p => p.id === wardrobeState.outer_bottom);
      if (otPiece && obPiece && otPiece.color_palette && obPiece.color_palette) {
        const otColor = wardrobeState.slot_colors.outer_top || otPiece.default_color_id;
        const palette = (wardrobe.color_palettes || {})[obPiece.color_palette] || [];
        if (palette.some(c => c.id === otColor)) {
          wardrobeState.slot_colors.outer_bottom = otColor;
          const el = $('select-color-outer-bottom');
          if (el) el.value = otColor;
          matched = true;
        }
      }

      if (matched) {
        updateModularPreview();
        showToast('🔗 Warna setelan atasan & bawahan berhasil diserasikan!', 'ok');
      } else {
        showToast('⚠️ Part yang dipilih belum memiliki palet warna serasi.', 'info');
      }
    });

    $('select-inner-visibility').addEventListener('change', (e) => {
      wardrobeState.inner_visibility = e.target.value;
      updateModularPreview();
    });

    $('btn-random-wardrobe').addEventListener('click', () => {
      const recipes = wardrobe.style_recipes || [];
      if (recipes.length) {
        const randRecipe = recipes[Math.floor(Math.random() * recipes.length)];
        $('select-wardrobe-recipe').value = randRecipe.id;
        applyWardrobeRecipe(randRecipe.id);
      }
    });

    $('btn-use-modular-in-studio').addEventListener('click', () => {
      const synth = generator.synthesizeModularAttire(wardrobeState, wardrobeState.inner_visibility);
      state.custom_attire_prompt = synth.promptText;
      state.custom_attire_name = synth.summaryText;

      $('modular-active-badge').style.display = 'flex';
      $('select-outfit').disabled = true;
      $('select-outfit-category').disabled = true;

      document.querySelector('[data-tab="tab-studio"]').click();
      updatePromptOutput();
      showToast('⚡ Busana modular berhasil dipasang di Studio Utama!', 'ok');
    });

    $('btn-copy-modular-prompt').addEventListener('click', () => {
      copyTextToClipboard($('wardrobe-prompt-text').textContent, 'Teks busana modular disalin!');
    });
    $('btn-download-modular-md').addEventListener('click', downloadModularWardrobeMarkdown);

    // Character Traits Events
    [
      ['select-trait-artstyle', 'art_style_id'],
      ['select-trait-hairstyle', 'hairstyle_id'],
      ['select-trait-haircolor', 'hair_color_id'],
      ['select-trait-expression', 'expression_id'],
      ['select-trait-complexion', 'skin_complexion_id'],
      ['select-trait-faceshape', 'face_shape_id'],
      ['select-trait-eyetype', 'eye_type_id'],
      ['select-trait-detail', 'facial_detail_id'],
      ['select-trait-shottype', 'shot_type_id'],
      ['select-trait-attire', 'neutral_attire_id'],
    ].forEach(([elId, prop]) => {
      $(elId).addEventListener('change', (e) => {
        traitsState[prop] = e.target.value;
        if (elId === 'select-trait-hairstyle') {
          syncTraitAttireForHair();
        }
        updateTraitPromptPreview();
      });
    });

    if ($('check-trait-regalia')) {
      $('check-trait-regalia').addEventListener('change', (e) => {
        traitsState.include_clan_regalia = e.target.checked;
        updateTraitPromptPreview();
      });
    }

    $('btn-random-traits').addEventListener('click', () => {
      const pick = (arr) => arr && arr.length ? arr[Math.floor(Math.random() * arr.length)].id : '';
      traitsState.art_style_id = pick(traits.art_styles);
      traitsState.hairstyle_id = pick(traits.hairstyles);
      traitsState.hair_color_id = pick(traits.hair_colors);
      traitsState.expression_id = pick(traits.expressions);
      traitsState.skin_complexion_id = pick(traits.skin_complexions);
      traitsState.face_shape_id = pick(traits.face_shapes);
      traitsState.eye_type_id = pick(traits.eye_types);
      traitsState.facial_detail_id = pick(traits.facial_details);

      $('select-trait-artstyle').value = traitsState.art_style_id;
      $('select-trait-hairstyle').value = traitsState.hairstyle_id;
      syncTraitAttireForHair();
      $('select-trait-haircolor').value = traitsState.hair_color_id;
      $('select-trait-expression').value = traitsState.expression_id;
      $('select-trait-complexion').value = traitsState.skin_complexion_id;
      $('select-trait-faceshape').value = traitsState.face_shape_id;
      $('select-trait-eyetype').value = traitsState.eye_type_id;
      $('select-trait-detail').value = traitsState.facial_detail_id;

      updateTraitPromptPreview();
      showToast('🎲 Sifat fisik karakter diacak!', 'ok');
    });

    $('btn-apply-hair-to-studio').addEventListener('click', () => {
      const res = generator.buildCharacterExplorationPrompt(traitsState);
      state.custom_hair_trait = res.hairstylePrompt;
      document.querySelector('[data-tab="tab-studio"]').click();
      updatePromptOutput();
      showToast('⚡ Gaya rambut diterapkan ke prompt Studio Utama!', 'ok');
    });

    $('btn-copy-trait-prompt').addEventListener('click', () => {
      copyTextToClipboard($('trait-prompt-preview').textContent, 'Prompt potret acuan disalin!');
    });
    $('btn-download-trait-md').addEventListener('click', downloadCharacterTraitMarkdown);

    // Bulk & Fitting Room Events
    $('select-bulk-mode').addEventListener('change', (e) => {
      const isVibe = e.target.value === 'vibe';
      $('bulk-vibe-controls').style.display = isVibe ? 'block' : 'none';
      $('group-bulk-vibe-select').style.display = isVibe ? 'block' : 'none';
      $('fitting-room-controls').style.display = isVibe ? 'none' : 'block';
    });

    $('btn-generate-bulk-run').addEventListener('click', runBulkGeneration);
    $('btn-copy-all-bulk').addEventListener('click', copyAllBulk);
    $('btn-download-bulk-md').addEventListener('click', downloadBulkMarkdown);

    // Delegate copy buttons in bulk list
    $('bulk-items-container').addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-copy-single');
      if (btn) {
        const index = parseInt(btn.getAttribute('data-index'), 10);
        if (lastBulkResults[index]) {
          copyTextToClipboard(lastBulkResults[index].fullPrompt, `Prompt #${index + 1} berhasil disalin!`);
        }
      }
    });

    // Contextual Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      // Ignore if user is inside input, textarea, or select
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const activePane = document.querySelector('.tab-pane.active')?.id || 'tab-studio';
      const key = e.key.toLowerCase();

      if (activePane === 'tab-studio') {
        if (key === 'g') {
          e.preventDefault();
          updatePromptOutput();
          showToast('⚡ Prompt diperbarui!', 'info');
        } else if (key === 'z') {
          e.preventDefault();
          rollCharacter();
        } else if (key === 'x') {
          e.preventDefault();
          rollThematicVibe();
        } else if (key === 't') {
          e.preventDefault();
          rollTotal();
        } else if (key === 'c') {
          e.preventDefault();
          copyTextToClipboard($('output-prompt-box').textContent);
        } else if (key === 's') {
          e.preventDefault();
          downloadActivePromptMarkdown();
        } else if (key === 'r') {
          e.preventDefault();
          resetForm();
        }
      } else if (activePane === 'tab-wardrobe') {
        if (key === 'z') {
          e.preventDefault();
          $('btn-random-wardrobe').click();
        } else if (key === 'g') {
          e.preventDefault();
          $('btn-use-modular-in-studio').click();
        } else if (key === 'c') {
          e.preventDefault();
          copyTextToClipboard($('wardrobe-prompt-text').textContent, 'Teks busana modular disalin!');
        } else if (key === 's') {
          e.preventDefault();
          downloadModularWardrobeMarkdown();
        }
      } else if (activePane === 'tab-traits') {
        if (key === 'z') {
          e.preventDefault();
          $('btn-random-traits').click();
        } else if (key === 'g') {
          e.preventDefault();
          $('btn-apply-hair-to-studio').click();
        } else if (key === 'c') {
          e.preventDefault();
          copyTextToClipboard($('trait-prompt-preview').textContent, 'Prompt potret acuan disalin!');
        } else if (key === 's') {
          e.preventDefault();
          downloadCharacterTraitMarkdown();
        }
      } else if (activePane === 'tab-bulk') {
        if (key === 'g') {
          e.preventDefault();
          runBulkGeneration();
        } else if (key === 'c') {
          e.preventDefault();
          copyAllBulk();
        } else if (key === 's') {
          e.preventDefault();
          downloadBulkMarkdown();
        }
      }
    });
  }

  // --- Initialize App ---
  function init() {
    initDropdowns();
    initTabs();
    bindEvents();

    // Initial Modular Preview
    updateModularPreview();

    // Initial Trait Preview
    updateTraitPromptPreview();

    // Initial Studio Output
    updateCameraAngleDropdown();
    updatePromptOutput();

    // Restore optional AI Horde key & initialize preview controls
    if ($('input-preview-horde-key')) {
      $('input-preview-horde-key').value = safeStorageGet(HORDE_KEY_STORAGE);
    }
    updatePreviewDimensionHint();
    syncPreviewControls();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
