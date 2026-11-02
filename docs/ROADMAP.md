# Roadmap

## Next (agreed with the owner)
1. **3D model fit panel** in the 3D tab: X/Y/Z offset, rotation and fine scale for "Your 3D model", saved per model, with a live preview.
2. **Blender reference head**: export MediaPipe's canonical face (centimetres, Y up, +Z towards the camera) as a `.glb` / `.obj` so users can model helmets, hats and glasses around it and get a perfect fit in the app.
3. **Blender session** (local Claude session on the owner's Mac, where the Blender MCP connector runs; cloud sessions can't reach it): build **original** masks and helmets and export `.glb` files for the 3D tab. Never copyrighted characters.
4. Optional **original hero mask** built into the app (2D, painted in UV space like Skull/Gold, colour-aware).

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
- Service worker gain on the second launch.
- Wake lock, haptics, share sheet and Add to Home Screen on phones.
- Contextual hints (dark, no hands, one hand, too close) with a live camera.

## Done (high level)
Prototype → WebGL2 + worker + One Euro → face filters, segmentation targets, shapes, colours, capture → light frosted-glass redesign in English → phone/desktop layouts, freeze, timer, pinch → face masks, custom masks, face swap → 3D accessories + user `.glb` → display modes (appear & disappear / inside frame / always) → latency prediction, signs, refinement, caching → research-driven robustness (handedness, 3D signs, temporal mask, tuned filter) → error handling and recovery → onboarding (priming, checklist, tutorial, hints, help) → CI + automatic `main` sync.
