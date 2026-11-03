# Roadmap

## Next (agreed with the owner)
1. ~~3D model fit panel~~ (done) and ~~Blender reference head~~ (done, `assets/reference/`).
2. **Blender session**: build more **original** masks and helmets and export `.glb` files for the 3D tab. Never copyrighted characters. First one done: **Aero** helmet (`assets/models/`, script `tools/blender-helmet.py`). It is a built-in tile in the 3D tab (`glb` option in `options.js`, fetched once, anchor "As modelled").
3. ~~Original hero mask~~ (done: **Kitsune**, colour-aware, in `masks.js`). More ideas: oni / hannya-inspired variants, a half mask.

## Music mode ideas
- Done: Chords, Arp, Beats, DJ modes, Band (6 styles), 11 sounds, presets, Learn (first steps, wait-mode songs, rhythm games, music basics), metronome.
- Done: "Your melody" import (MIDI, audio, mic recording, typed notes) for the Learn tab.
- Next for "Your melody": melody from a full song (lazy-loaded Basic Pitch or a vocal-separation model, then skyline); MusicXML / ABC import; editing a wrong note after import; sharing a melody as a link; a timing-aware mode (play in rhythm, not just in order).
- Next: quantised looper (snap to the band's bars) and loop layers; falling-notes view for songs; more songs (public domain only); saving / sharing a Beats pattern; swing; chord inversions and voice leading.
- Velocity from hand depth (world z), vibrato from hand shake on the theremin.
- MIDI CC output (hand height → filter / mod wheel) and MIDI clock.
- Audio-reactive visuals in effects mode (the frame pulsing with the music).

## Superpower ideas
- Done: 16 powers (energy wave, lightning, pyro, frost, force, shield, reality warp, invisibility, time stop, speedster, clones, teleport, size shift, laser vision, portal, power up), scene lighting, heat haze, scorch marks, light wrap, cinematic look, training rounds with golden targets, 👍 hands-free switch, photo of big moments, haptics.
- Next: combos between powers (fireball through a portal, lightning into the energy ball, a beam reflected by the shield), telekinesis that lifts real objects (segment an object, move its pixels), body-wide powers with the pose model (a cape, wings, a ground-pound shockwave), two-player duels (one power each, hits on the other person), a daily challenge, a slow-motion replay of the last big moment.
- Per-power tuning after real-device tests: charge distance (1.9 hand sizes), clap speed (2.4 → 1.15 sizes within 0.35 s), push growth (+22 % in 0.25 s), flick speed (1.5 heights / s), mouth-open threshold (0.24 on / 0.14 off), circle roundness (0.32), frost "still" speed (0.6), teleport pointing hold (0.7 s) and the 0.5 sideways threshold, pinch-zoom range (0.35–1.8), 👍 switch hold (0.8 s), light strength (×1.5).

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
- Superpower mode, round 2: how the scene lighting looks on real skin and walls (it may need a cap in bright rooms), light wrap strength on teleport / size shift, frost readability on busy backgrounds, the shield's hex size on phones, cinematic letterbox in portrait.
- Superpower mode with real hands and a real room: every gesture threshold above, the invisibility clean plate (lighting changes, auto-exposure), selfie-segmenter edge quality, laser aim (`faceAim` neutral pitch 0.6), clones spacing, real FPS with the world pass + glow pass on phones.
- Music mode with real hands (all 8 instruments): finger-count chord picking (`fingerCount` thresholds), strum line feel, beats-grid pinch targeting, DJ filter range, rhythm windows (70/140 ms) and the song lessons' wait mode; pinch thresholds, harp crossing feel, drum strike speed (`minSpeed`), audible latency, Web MIDI with a real DAW, audio in recorded videos (Safari MP4 + AAC).
- "Your melody" with real input: humming / singing into a real mic (only Chrome's fake mic was tested: it beeps, so no notes came out), MP3 / M4A from phones (only WAV was tested), Safari's `OfflineAudioContext` at 22 050 Hz and `MediaRecorder` (audio/mp4), real MIDI files from the web (multi-track picks), analysis time for 90 s of audio on a low-end phone.

## Done (high level)
Prototype → WebGL2 + worker + One Euro → face filters, segmentation targets, shapes, colours, capture → light frosted-glass redesign in English → phone/desktop layouts, freeze, timer, pinch → face masks, custom masks, face swap → 3D accessories + user `.glb` → display modes (appear & disappear / inside frame / always) → latency prediction, signs, refinement, caching → research-driven robustness (handedness, 3D signs, temporal mask, tuned filter) → error handling and recovery → onboarding (priming, checklist, tutorial, hints, help) → CI + automatic `main` sync → in-app "make your own" guides → music mode (theremin, keys, harp, drums, looper, MIDI, recording with sound) → 3D model fine-tune panel (saved per model) + Blender reference head with "As modelled" anchor.
