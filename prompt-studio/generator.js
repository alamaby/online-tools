/**
 * generator.js - Prompt Generation Engine for Aluna Prompt Studio (Web Edition)
 * Zero-dependency, purely client-side logic ported from generator.py, presets.py,
 * wardrobe.py, and character_traits.py.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PromptGeneratorEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function getRandomItem(array) {
    if (!array || array.length === 0) return null;
    return array[Math.floor(Math.random() * array.length)];
  }

  // --- Dynamic Trait Binding ---
  function resolveAlunaPhysicalPrompt(refItem, customHairTrait, concise, presets) {
    const baseline = concise ? presets.aluna_physical_concise : presets.aluna_baseline_physical;
    const canonicalHair = concise ? presets.canonical_hair_concise : presets.canonical_hair_baseline;

    if (!customHairTrait || !customHairTrait.trim()) {
      return baseline;
    }

    let cleanHair = customHairTrait.trim().replace(/\.+$/, '');
    let hairSentence = '';

    if (concise) {
      hairSentence = (cleanHair.charAt(0).toUpperCase() + cleanHair.slice(1)) + '.';
      if (baseline.includes(canonicalHair)) {
        return baseline.replace(canonicalHair, hairSentence);
      }
      return `${baseline} ${hairSentence}`;
    } else {
      if (cleanHair.toLowerCase().startsWith('her ')) {
        hairSentence = `${cleanHair}.`;
      } else {
        hairSentence = `Her ${cleanHair}.`;
      }
      if (baseline.includes(canonicalHair)) {
        return baseline.replace(canonicalHair, hairSentence);
      }
      return `${baseline} ${hairSentence}`;
    }
  }

  class PromptGenerator {
    constructor(presetsData, wardrobeData, traitsData) {
      this.presets = presetsData || window.PROMPT_STUDIO_PRESETS || {};
      this.wardrobe = wardrobeData || window.PROMPT_STUDIO_WARDROBE || {};
      this.traits = traitsData || window.PROMPT_STUDIO_TRAITS || {};

      this._buildLookupMaps();
    }

    _buildLookupMaps() {
      this.outfitMap = new Map((this.presets.outfits || []).map(item => [item.id, item]));
      this.sceneryMap = new Map((this.presets.sceneries || []).map(item => [item.id, item]));
      this.poseMap = new Map((this.presets.poses || []).map(item => [item.id, item]));
      this.angleMap = new Map((this.presets.camera_angles || []).map(item => [item.id, item]));
      this.lightMap = new Map((this.presets.lightings || []).map(item => [item.id, item]));
      this.arMap = new Map((this.presets.aspect_ratios || []).map(item => [item.id, item]));
      this.engineMap = new Map((this.presets.target_engines || []).map(item => [item.id, item]));
      this.loverMap = new Map((this.presets.lover_archetypes || []).map(item => [item.id, item]));
      this.refMap = new Map((this.presets.image_references || []).map(item => [item.id, item]));

      // Wardrobe maps
      this.innerTopMap = new Map((this.wardrobe.inner_tops || []).map(p => [p.id, p]));
      this.outerTopMap = new Map((this.wardrobe.outer_tops || []).map(p => [p.id, p]));
      this.innerBottomMap = new Map((this.wardrobe.inner_bottoms || []).map(p => [p.id, p]));
      this.outerBottomMap = new Map((this.wardrobe.outer_bottoms || []).map(p => [p.id, p]));
      this.layerAccMap = new Map((this.wardrobe.layer_accessories || []).map(p => [p.id, p]));
      this.footwearMap = new Map((this.wardrobe.footwear || []).map(p => [p.id, p]));

      // Vehicle harmony
      this.vehiclePoses = new Set(this.presets.vehicle_poses || []);
      this.outdoorSceneries = new Set(this.presets.outdoor_parking_sceneries || []);
      this.recAnglesMap = this.presets.pose_recommended_angles || {};
    }

    isVehiclePose(poseId) {
      return this.vehiclePoses.has(poseId);
    }

    isValidVehicleScenery(sceneryId) {
      return this.outdoorSceneries.has(sceneryId);
    }

    getRecommendedAnglesForPose(poseId) {
      return this.recAnglesMap[poseId] || ['medium_shot', 'full_body'];
    }

    getRecommendedPosesForAngle(angleId) {
      const poses = [];
      for (const [pId, angles] of Object.entries(this.recAnglesMap)) {
        if (angles.includes(angleId)) {
          poses.push(pId);
        }
      }
      return poses;
    }

    isPoseAngleCompatible(poseId, angleId) {
      const recs = this.recAnglesMap[poseId] || [];
      return recs.includes(angleId);
    }

    resolveRefString(config) {
      if (config.custom_ref_path && config.custom_ref_path.trim()) {
        return config.custom_ref_path.trim();
      }
      const refItem = this.refMap.get(config.image_ref_id) || (this.presets.image_references ? this.presets.image_references[0] : null);
      return refItem && refItem.prompt_text ? refItem.prompt_text.trim() : '';
    }

    generate(config) {
      let outfitPrompt = '';
      let outfitName = '';

      if (config.custom_attire_prompt && config.custom_attire_prompt.trim()) {
        outfitPrompt = config.custom_attire_prompt.trim();
        outfitName = config.custom_attire_name && config.custom_attire_name.trim() ? config.custom_attire_name.trim() : '✨ [Kustom Modular Mix & Match Aktif]';
      } else {
        const outfit = this.outfitMap.get(config.outfit_id) || (this.presets.outfits ? this.presets.outfits[0] : {});
        outfitPrompt = outfit.prompt_text || '';
        outfitName = outfit.name || '';
      }

      const scenery = this.sceneryMap.get(config.scenery_id) || (this.presets.sceneries ? this.presets.sceneries[0] : {});
      const pose = this.poseMap.get(config.pose_id) || (this.presets.poses ? this.presets.poses[0] : {});
      const angle = this.angleMap.get(config.camera_angle_id) || (this.presets.camera_angles ? this.presets.camera_angles[0] : {});
      const lighting = this.lightMap.get(config.lighting_id) || (this.presets.lightings ? this.presets.lightings[0] : {});
      const ar = this.arMap.get(config.aspect_ratio_id) || (this.presets.aspect_ratios ? this.presets.aspect_ratios[0] : {});

      const crefPath = this.resolveRefString(config);
      const selectedRef = this.refMap.get(config.image_ref_id) || null;

      // Handle Duo Pose & Lover Profile
      const isDuoPose = (config.pose_id && config.pose_id.startsWith('pose_duo_')) || (pose.prompt_text && pose.prompt_text.includes('{lover_desc}'));
      let loverProfileName = 'N/A (Bukan Pose Duo)';
      let posePrompt = pose.prompt_text || '';

      if (isDuoPose) {
        const loverItem = this.loverMap.get(config.lover_profile_id) || (this.presets.lover_archetypes ? this.presets.lover_archetypes[0] : {});
        let loverDesc = '';

        if (config.lover_profile_id === 'random' || !loverItem.prompt_text) {
          const slots = this.presets.lover_slots || {};
          const spine = getRandomItem(slots.spine) || 'tall, broad-shouldered build';
          const torso = getRandomItem(slots.torso) || 'weathered yet sturdy chest';
          const hair = getRandomItem(slots.hair) || 'salt-and-pepper cropped hair';
          const skin = getRandomItem(slots.skin_hands) || 'warm tan skin with veined, capable hands';
          const apparel = getRandomItem(slots.apparel) || 'dark casual linen shirt';
          loverDesc = `showing a mature older lover with a ${spine}, a ${torso}, ${hair}, ${skin}, wearing a ${apparel}`;
          loverProfileName = '🎲 Acak Penuh (Dynamic Random)';
        } else {
          loverDesc = loverItem.prompt_text;
          loverProfileName = loverItem.name || '';
        }

        if (posePrompt.includes('{lover_desc}')) {
          posePrompt = posePrompt.replace('{lover_desc}', loverDesc);
        } else {
          posePrompt = `${posePrompt} ${loverDesc}`;
        }
      }

      // Spatial Guard (Vehicle Poses vs Enclosed Indoor Sceneries)
      let spatialAdapted = false;
      let sceneTextMain = '';
      let sceneTextSdxl = '';

      if (config.spatial_guard && this.isVehiclePose(config.pose_id) && !this.isValidVehicleScenery(config.scenery_id)) {
        spatialAdapted = true;
        let locName = scenery.name || '';
        if (locName.includes('.')) locName = locName.split('.')[1];
        if (locName.includes('(')) locName = locName.split('(')[0];
        locName = locName.trim();

        sceneTextMain = `Parked outdoors in the open-air driveway, curbside pavement, and storefront parking area directly in front of ${locName}, with the exterior architectural facade, entrance, and ambient windows visible in the background. ${lighting.prompt_text || ''}`;
        sceneTextSdxl = `outdoors street pavement and parking driveway in front of ${locName}, exterior building facade backdrop, ${lighting.prompt_text || ''}`;
      } else {
        sceneTextMain = `${scenery.prompt_text || ''} ${lighting.prompt_text || ''}`;
        sceneTextSdxl = `${scenery.prompt_text || ''} ${lighting.prompt_text || ''}`;
      }

      // 1. Base Art Style & Camera Framing
      const header = `${this.presets.art_style_master}. ${angle.prompt_text || ''}`;

      // 2. Scene Environment & Lighting
      const sceneSection = `Scene & Setting: ${sceneTextMain}`;

      // 3. Character & Pose (with dynamic trait binding if custom hairstyle provided)
      const alunaPhysical = resolveAlunaPhysicalPrompt(selectedRef, config.custom_hair_trait || '', false, this.presets);
      const characterSection = `Character & Pose: ${alunaPhysical} ${posePrompt}`;

      // 4. Attire & Optional Accessories
      let attireSection = `Attire: ${outfitPrompt}`;
      if (config.include_clan_regalia) {
        attireSection += ` Sacred Clan Regalia: ${this.presets.clan_regalia_accessories}`;
      }

      // 5. Familiar (Aki Bolang)
      let familiarSection = '';
      if (config.include_aki_bolang) {
        familiarSection = `Familiar Mentor: ${this.presets.familiar_aki_bolang}`;
      }

      // 6. Passive Lunar Ward layer
      let lunarSection = '';
      if (config.include_lunar_ward) {
        lunarSection = `Passive Lunar Ward: ${this.presets.lunar_ward_layer}`;
      }

      // 7. Custom details
      let customSection = '';
      if (config.custom_details && config.custom_details.trim()) {
        customSection = `Additional Details: ${config.custom_details.trim()}.`;
      }

      // Assemble sections
      const sections = [header, sceneSection, characterSection, attireSection];
      if (familiarSection) sections.push(familiarSection);
      if (lunarSection) sections.push(lunarSection);
      if (customSection) sections.push(customSection);

      const basePrompt = sections.join(' \n\n');

      // Engine-specific formatting
      const engineId = config.target_engine_id || 'midjourney';
      let fullPrompt = '';
      let negativePrompt = null;

      if (engineId === 'midjourney') {
        const params = [ar.prompt_text || '--ar 16:9', '--stylize 250'];
        if (crefPath) {
          params.push(`--cref ${crefPath}`);
          if (config.cw_weight && Number(config.cw_weight) !== 100) {
            params.push(`--cw ${config.cw_weight}`);
          }
        }
        fullPrompt = `${basePrompt} \n\n${params.join(' ')}`;
        negativePrompt = null;
      } else if (engineId === 'sdxl_flux') {
        const sdxlHeader = `masterpiece, best quality, ultra-detailed 8k, official art, ${this.presets.art_style_concise}. ${angle.prompt_text || ''}`;
        const sdxlScene = `Setting: ${sceneTextSdxl}`;
        const alunaPhysicalConcise = resolveAlunaPhysicalPrompt(selectedRef, config.custom_hair_trait || '', true, this.presets);
        const sdxlCharacter = `Character: ${alunaPhysicalConcise} ${posePrompt}`;
        let sdxlAttire = `Attire: ${outfitPrompt}`;
        if (config.include_clan_regalia) {
          sdxlAttire += ` ${this.presets.clan_regalia_concise}`;
        }

        const sdxlSections = [sdxlHeader, sdxlScene, sdxlCharacter, sdxlAttire];
        if (config.include_aki_bolang) sdxlSections.push(`Familiar: ${this.presets.familiar_bolang_concise}`);
        if (config.include_lunar_ward) sdxlSections.push(`Lunar Ward: ${this.presets.lunar_ward_concise}`);
        if (config.custom_details && config.custom_details.trim()) {
          sdxlSections.push(`Details: ${config.custom_details.trim()}.`);
        }

        fullPrompt = sdxlSections.join(' \n\n');
        if (isDuoPose) {
          negativePrompt = `${this.presets.negative_prompt_default}, pregnant Aluna, chubby Aluna, hunched woman, wrinkled woman, wrinkled skin on Aluna, age spots on female subject, visible man face, man face reveal, extra arms, extra hands, fused fingers, three hands, extra legs, fused legs, mutated limbs`;
        } else {
          negativePrompt = this.presets.negative_prompt_default;
        }
      } else {
        // Natural Language API (DALL-E 3 / Imagen / Gemini / ChatGPT)
        const arRatio = config.aspect_ratio_id || '16:9';
        fullPrompt = `An ultra-detailed illustration in semi-realistic anime light novel style with an aspect ratio of ${arRatio}. \n\n${basePrompt}`;
        if (crefPath) {
          fullPrompt += ` Maintain strict visual identity, hairstyle, and facial consistency with reference image: ${crefPath}.`;
        }
        negativePrompt = null;
      }

      const metadata = {
        aspect_ratio: ar.name || '',
        image_reference: crefPath ? crefPath : 'None',
        cw_weight: String(config.cw_weight || 80),
        outfit: outfitName,
        scenery: scenery.name || '',
        pose: pose.name || '',
        lover_profile: loverProfileName,
        camera_angle: angle.name || '',
        lighting: lighting.name || '',
        engine: engineId,
        aki_bolang: config.include_aki_bolang ? 'Ya (Aktif)' : 'Tidak',
        clan_regalia: config.include_clan_regalia ? 'Ya (Lengkap)' : 'Tidak',
        lunar_ward: config.include_lunar_ward ? 'Ya (Aktif)' : 'Tidak',
        spatial_guard: spatialAdapted ? 'Aktif (Latar diadaptasi ke parkir luar)' : 'Normal (Preset)',
        custom_details: config.custom_details && config.custom_details.trim() ? config.custom_details.trim() : '-',
      };

      return {
        fullPrompt,
        negativePrompt,
        metadata,
      };
    }

    generateBulk(vibeId, count, baseConfig, locks) {
      const vibes = this.presets.thematic_vibes || {};
      const vibe = vibes[vibeId] || vibes['vibe_retail'] || {
        outfits: ['uniform_bumimart'],
        sceneries: ['bumimart_pos1'],
        poses: ['pose_sop_greeting'],
        camera_angles: ['medium_shot'],
        lightings: ['morning_sunbeams']
      };

      const requestedCount = Math.max(1, Math.min(count || 5, 30));
      const base = baseConfig || {};
      const l = locks || {};

      const poolOutfits = l.lock_outfit ? [l.locked_outfit_id || 'uniform_bumimart'] : vibe.outfits;
      const poolSceneries = l.lock_scenery ? [l.locked_scenery_id || 'bumimart_pos1'] : vibe.sceneries;
      const poolPoses = l.lock_pose ? [l.locked_pose_id || 'pose_sop_greeting'] : vibe.poses;
      const poolAngles = l.lock_camera_angle ? [l.locked_camera_angle_id || 'medium_shot'] : vibe.camera_angles;
      const poolLightings = l.lock_lighting ? [l.locked_lighting_id || 'morning_sunbeams'] : vibe.lightings;

      const maxCombos = Math.max(1, new Set(poolOutfits).size) *
        Math.max(1, new Set(poolSceneries).size) *
        Math.max(1, new Set(poolPoses).size) *
        Math.max(1, new Set(poolAngles).size) *
        Math.max(1, new Set(poolLightings).size);

      const targetCount = Math.min(requestedCount, maxCombos);
      const results = [];
      const seenCombos = new Set();
      const maxAttempts = targetCount * 60;
      let attempts = 0;

      while (results.length < targetCount && attempts < maxAttempts) {
        attempts++;
        const outfitId = l.lock_outfit ? (l.locked_outfit_id || 'uniform_bumimart') : getRandomItem(poolOutfits);
        const poseId = l.lock_pose ? (l.locked_pose_id || 'pose_sop_greeting') : getRandomItem(poolPoses);
        const sceneryId = l.lock_scenery ? (l.locked_scenery_id || 'bumimart_pos1') : getRandomItem(poolSceneries);
        const angleId = l.lock_camera_angle ? (l.locked_camera_angle_id || 'medium_shot') : getRandomItem(poolAngles);
        const lightingId = l.lock_lighting ? (l.locked_lighting_id || 'morning_sunbeams') : getRandomItem(poolLightings);

        const comboKey = `${outfitId}|${sceneryId}|${poseId}|${angleId}|${lightingId}`;
        if (seenCombos.has(comboKey)) continue;
        seenCombos.add(comboKey);

        const cfg = Object.assign({}, base, {
          outfit_id: outfitId,
          custom_attire_prompt: (l.lock_outfit && l.locked_custom_prompt) ? l.locked_custom_prompt : '',
          custom_attire_name: (l.lock_outfit && l.locked_custom_name) ? l.locked_custom_name : '',
          scenery_id: sceneryId,
          pose_id: poseId,
          camera_angle_id: angleId,
          lighting_id: lightingId,
        });

        const gen = this.generate(cfg);
        results.push({
          fullPrompt: gen.fullPrompt,
          negativePrompt: gen.negativePrompt,
          metadata: gen.metadata,
          config: cfg,
        });
      }

      return results;
    }

    generateOutfitMatrix(poseId, sceneryId, angleId, lightingId, baseConfig, categoryId) {
      let outfits = this.presets.outfits || [];
      if (categoryId && categoryId !== 'all') {
        outfits = outfits.filter(o => o.category === categoryId);
      }

      const results = [];
      const base = baseConfig || {};

      for (const outfitItem of outfits) {
        const cfg = Object.assign({}, base, {
          outfit_id: outfitItem.id,
          custom_attire_prompt: '',
          custom_attire_name: '',
          scenery_id: sceneryId,
          pose_id: poseId,
          camera_angle_id: angleId || 'medium_shot',
          lighting_id: lightingId || 'morning_sunbeams',
        });

        const gen = this.generate(cfg);
        results.push({
          fullPrompt: gen.fullPrompt,
          negativePrompt: gen.negativePrompt,
          metadata: gen.metadata,
          config: cfg,
          outfitItem: outfitItem,
        });
      }

      return results;
    }

    renderPiece(piece, colorId) {
      if (!piece) return { prompt: '', name: '' };
      if (!piece.color_palette || !piece.color_template) {
        return { prompt: piece.prompt_fragment || '', name: piece.name || '' };
      }
      const palette = (this.wardrobe.color_palettes || {})[piece.color_palette] || [];
      const activeColorId = colorId || piece.default_color_id;
      const colorOpt = palette.find(c => c.id === activeColorId) || palette[0];
      if (!colorOpt) {
        return { prompt: piece.prompt_fragment || '', name: piece.name || '' };
      }
      const renderedPrompt = piece.color_template.replace('{color}', colorOpt.en_color);
      const renderedName = piece.id_name_template
        ? piece.id_name_template.replace('{color_id}', colorOpt.id_color)
        : `${piece.name} (${colorOpt.id_color})`;
      return { prompt: renderedPrompt, name: renderedName };
    }

    synthesizeModularAttire(slots, innerVisibility) {
      const innerTop = this.innerTopMap.get(slots.inner_top) || null;
      const innerBottom = this.innerBottomMap.get(slots.inner_bottom) || null;
      const outerTop = this.outerTopMap.get(slots.outer_top) || null;
      const outerBottom = this.outerBottomMap.get(slots.outer_bottom) || null;
      const layerAcc = this.layerAccMap.get(slots.layer_accessory) || null;
      const footwear = this.footwearMap.get(slots.footwear) || null;

      const colors = slots.slot_colors || {};
      const itR = this.renderPiece(innerTop, colors.inner_top);
      const ibR = this.renderPiece(innerBottom, colors.inner_bottom);
      const otR = this.renderPiece(outerTop, colors.outer_top);
      const obR = this.renderPiece(outerBottom, colors.outer_bottom);
      const laR = this.renderPiece(layerAcc, colors.layer_accessory);
      const fwR = this.renderPiece(footwear, colors.footwear);

      const vis = innerVisibility || 'hidden';
      const enParts = [];
      const idParts = [];

      const isOnePiece = outerTop ? outerTop.is_one_piece : false;

      // 1. Outerwear Vest / Jacket
      if (layerAcc && layerAcc.id !== 'layer_none') {
        const isUpperLayer = ['vest', 'jacket', 'bolero', 'cardigan'].some(k => layerAcc.id.includes(k));
        if (isUpperLayer) {
          enParts.push(laR.prompt);
          idParts.push(`Layer: ${laR.name}`);
        }
      }

      // 2. Outer Top or Standalone Inner Top
      if (outerTop && outerTop.id !== 'outer_top_none') {
        let topText = otR.prompt;
        if (innerTop && innerTop.id !== 'inner_top_none') {
          if (vis === 'subtle') {
            topText += `, with a subtle glimpse of ${itR.prompt} beneath`;
          } else if (vis === 'exposed') {
            topText += `, layered revealingly over ${itR.prompt}`;
          }
        }
        enParts.push(topText);
        idParts.push(`Atasan: ${otR.name}`);
        if (innerTop && innerTop.id !== 'inner_top_none' && vis !== 'hidden') {
          idParts.push(`Dalaman Atas (${vis}): ${itR.name}`);
        }
      } else if (innerTop && innerTop.id !== 'inner_top_none') {
        enParts.push(`wearing ${itR.prompt}`);
        idParts.push(`Atasan (Innerwear Standalone): ${itR.name}`);
      }

      // 3. Outer Bottom or Standalone Inner Bottom
      if (!isOnePiece) {
        if (outerBottom && outerBottom.id !== 'outer_bottom_none') {
          enParts.push(`paired with ${obR.prompt}`);
          idParts.push(`Bawahan: ${obR.name}`);
          if (innerBottom && innerBottom.id !== 'inner_bottom_none' && (vis === 'subtle' || vis === 'exposed')) {
            idParts.push(`Dalaman Bawah: ${ibR.name}`);
          }
        } else if (innerBottom && innerBottom.id !== 'inner_bottom_none') {
          enParts.push(`paired with ${ibR.prompt}`);
          idParts.push(`Bawahan (Innerwear Standalone): ${ibR.name}`);
        }
      } else {
        idParts.push('Bawahan: [Menyatu dalam Gaun Terusan]');
      }

      // 4. Waist & Hip Layering
      if (layerAcc && layerAcc.id !== 'layer_none') {
        const isWaistLayer = ['tied', 'apron', 'sarong', 'stagen', 'belt'].some(k => layerAcc.id.includes(k));
        if (isWaistLayer) {
          enParts.push(`accentuated by ${laR.prompt}`);
          if (!idParts.some(p => p.startsWith('Layer:'))) {
            idParts.push(`Layer Pinggang: ${laR.name}`);
          }
        }
      }

      // 5. Footwear
      if (footwear && footwear.id !== 'footwear_barefoot' && footwear.prompt_fragment) {
        enParts.push(`completing the ensemble with ${fwR.prompt}`);
        idParts.push(`Alas Kaki: ${fwR.name}`);
      } else if (footwear && footwear.id === 'footwear_barefoot') {
        enParts.push(fwR.prompt);
        idParts.push(`Alas Kaki: ${fwR.name}`);
      }

      const enPrompt = enParts.join('; ').trim() + (enParts.length ? '.' : '');
      const idSummary = idParts.join('\n');

      return {
        promptText: enPrompt,
        summaryText: idSummary,
      };
    }

    buildCharacterExplorationPrompt(traitsConfig) {
      const t = traitsConfig || {};
      const hairstyle = (this.traits.hairstyles || []).find(x => x.id === t.hairstyle_id);
      const hairColor = (this.traits.hair_colors || []).find(x => x.id === t.hair_color_id);
      const expression = (this.traits.expressions || []).find(x => x.id === t.expression_id);
      const complexion = (this.traits.skin_complexions || []).find(x => x.id === t.skin_complexion_id);
      const faceShape = (this.traits.face_shapes || []).find(x => x.id === t.face_shape_id);
      const eyeType = (this.traits.eye_types || []).find(x => x.id === t.eye_type_id);
      const facialDetail = (this.traits.facial_details || []).find(x => x.id === t.facial_detail_id);
      const shotType = (this.traits.shot_types || []).find(x => x.id === t.shot_type_id);
      const neutralAttire = (this.traits.neutral_attires || []).find(x => x.id === t.neutral_attire_id);

      const parts = [];

      // Shot type & master style
      const defaultShot = (this.traits.shot_types && this.traits.shot_types[0]) ? this.traits.shot_types[0].prompt_fragment : 'horizontal wide composition displaying 4 full-body views in consistent proportions: Front View, Three-Quarter (3/4) View, Side Profile View, and Back View of the same character on a clean neutral studio backdrop';
      const shotText = shotType ? shotType.prompt_fragment : defaultShot;
      const artStyle = (this.traits.art_styles || []).find(x => x.id === t.art_style_id);
      const styleText = artStyle ? artStyle.prompt_fragment : this.presets.art_style_master;
      parts.push(`${shotText}, ${styleText}`);

      // Locked canonical demographics
      parts.push(`depicting a 23-year-old Sundanese young woman with graceful Sundanese facial features`);

      // Face shape & complexion
      const defaultFace = (this.traits.face_shapes && this.traits.face_shapes[0]) ? this.traits.face_shapes[0].prompt_fragment : 'charming delicate oval face contour with soft feminine jawline';
      const defaultComp = (this.traits.skin_complexions && this.traits.skin_complexions[0]) ? this.traits.skin_complexions[0].prompt_fragment : 'flawless radiant porcelain-bright fair skin (kulit putih cerah berseri)';
      const faceText = faceShape ? faceShape.prompt_fragment : defaultFace;
      const compText = complexion ? complexion.prompt_fragment : defaultComp;
      parts.push(`${faceText}, ${compText}`);

      // Eyes & expression
      const defaultEye = (this.traits.eye_types && this.traits.eye_types[0]) ? this.traits.eye_types[0].prompt_fragment : 'warm walnut-brown almond eyes with a gentle, intelligent, and welcoming gaze';
      const defaultExpr = (this.traits.expressions && this.traits.expressions[0]) ? this.traits.expressions[0].prompt_fragment : 'an authentic welcoming two-finger symmetric retail smile radiating genuine hospitality, natural rosy lips';
      const eyeText = eyeType ? eyeType.prompt_fragment : defaultEye;
      const exprText = expression ? expression.prompt_fragment : defaultExpr;
      parts.push(`${eyeText}, ${exprText}`);

      // Facial details
      if (facialDetail && facialDetail.prompt_fragment) {
        parts.push(facialDetail.prompt_fragment);
      } else if (this.traits.facial_details && this.traits.facial_details[0]) {
        parts.push(this.traits.facial_details[0].prompt_fragment);
      }

      // Hair / Hijab
      const isHijab = hairstyle && hairstyle.extra && hairstyle.extra.is_hijab;
      const colorText = hairColor ? hairColor.prompt_fragment : (this.traits.hair_colors && this.traits.hair_colors[0] ? this.traits.hair_colors[0].prompt_fragment : 'glossy raven-black');
      const hairStyleText = hairstyle ? hairstyle.prompt_fragment : (this.traits.hairstyles && this.traits.hairstyles[0] ? this.traits.hairstyles[0].prompt_fragment : 'hair styled in an elegant high barista bun');
      let hairOrHijabPrompt = '';
      if (isHijab) {
        hairOrHijabPrompt = `Headwear & Hijab: ${hairstyle.prompt_fragment}, with hair, ears, and neck completely concealed underneath`;
      } else {
        hairOrHijabPrompt = `Hair: ${colorText} ${hairStyleText}`;
      }
      parts.push(hairOrHijabPrompt);

      // Neutral attire
      if (neutralAttire && neutralAttire.prompt_fragment) {
        parts.push(`Attire: ${neutralAttire.prompt_fragment}`);
      } else if (this.traits.neutral_attires && this.traits.neutral_attires[0]) {
        parts.push(`Attire: ${this.traits.neutral_attires[0].prompt_fragment}`);
      }

      // Regalia
      if (t.include_clan_regalia !== false) {
        if (!isHijab && this.presets.clan_regalia_accessories) {
          parts.push(`Sacred Hairpin: 15cm carved rustic dark acacia wulung wooden hairpin (Pasak Pangeker Mana limiter)`);
        }
        parts.push(`Sacred Clan Regalia: hand-braided red-white-black Tridatu cord bracelet on left wrist, minimalist plain 925 sterling silver band ring on left pinky finger, and subtle silver kemuning leaf charm anklet on right ankle`);
      }

      // Lighting & backdrop
      parts.push(`soft neutral studio portrait lighting with clean warm highlights, plain studio backdrop`);

      return {
        promptText: parts.join(', '),
        hairstylePrompt: isHijab ? hairstyle.prompt_fragment : (hairstyle ? `${colorText} ${hairStyleText}` : ''),
      };
    }
  }

  return {
    PromptGenerator,
    resolveAlunaPhysicalPrompt,
  };
});
