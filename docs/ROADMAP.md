# Roadmap

## Next (agreed with the owner)
1. ~~3D model fit panel~~ (done) and ~~Blender reference head~~ (done, `assets/reference/`).
2. **Blender session**: build more **original** masks and helmets and export `.glb` files for the 3D tab. Never copyrighted characters. First one done: **Aero** helmet (`assets/models/`, script `tools/blender-helmet.py`). It is a built-in tile in the 3D tab (`glb` option in `options.js`, fetched once, anchor "As modelled").
3. ~~Original hero mask~~ (done: **Kitsune**, colour-aware, in `masks.js`). More ideas: oni / hannya-inspired variants, a half mask.

## Ideas backlog
- Jaw-open / blink blendshapes driving 3D accessories (visor opening, eyes glowing).
- Hair segmentation + hood mask covering the whole head.
- Face-swap quality: Poisson-style blending pass, better colour matching.
- Recording with audio (microphone or music track).
- WebGPU path once MediaPipe web supports it in stable.

## To verify on real devices (not verifiable in the GPU-less container)
- Real FPS / latency on iPhone, Android and Mac (HUD: `D` key).
- One-hand signs and pinch with real hands (thresholds may need tuning).
- Segmentation edge refinement and temporal stabilisation visually.
- Face swap with a photo of another person.
- `.glb` loading with a real Blender export (Draco).
- Fit sliders on a real phone (touch drag inside the horizontally scrolling row) and "As modelled" with a real face.
- Service worker gain on the second launch.
- Wake lock, haptics, share sheet and Add to Home Screen on phones.
- Contextual hints (dark, no hands, one hand, too close) with a live camera.

## Done (high level)
Prototype → WebGL2 + worker + One Euro → face filters, segmentation targets, shapes, colours, capture → light frosted-glass redesign in English → phone/desktop layouts, freeze, timer, pinch → face masks, custom masks, face swap → 3D accessories + user `.glb` → display modes (appear & disappear / inside frame / always) → latency prediction, signs, refinement, caching → research-driven robustness (handedness, 3D signs, temporal mask, tuned filter) → error handling and recovery → onboarding (priming, checklist, tutorial, hints, help) → CI + automatic `main` sync → 3D model fine-tune panel (saved per model) + Blender reference head with "As modelled" anchor.
