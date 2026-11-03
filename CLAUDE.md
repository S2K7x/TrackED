# TrackED: context for Claude sessions

Real-time "finger frame" camera app in the browser. The user makes an **L with the thumb and index of each hand**, and a live frame appears between the hands. Everything inside it is transformed: colour effects, face filters, face masks, 3D accessories, segmentation targets. Two more modes: **Music** (play instruments with the hands) and **Powers** (16 original superpowers). The app is static (no build step, no backend) and runs fully on-device.

Owner: S2K7x (French-speaking; answer in French, keep **all code, UI text, comments and docs in English**).

## Read these first
- `docs/RESEARCH.md`: everything researched so far (ML papers, techniques, UX guidance), with sources.
- `docs/DECISIONS.md`: key technical decisions, their reasons, and bugs found or fixed.
- `docs/ROADMAP.md`: what's next, open questions, and what still needs verifying on real devices.
- `docs/TESTING.md`: how to test (unit tests, headless browser with a fake camera, failure injection).
- `README.md`: user-facing docs (features, quick start, architecture, robustness).

## Commands
```bash
npm start    # python3 -m http.server 8000 → http://localhost:8000
npm test     # node --test tests/*.test.mjs (114 tests, Node 20+)
node tools/powers-smoke.cjs --cam cam.y4m --out shots   # light headless check of every power (see docs/TESTING.md)
npm run check  # node --check on every module (also in CI)
node tools/tune-filter.mjs                                   # One Euro tuning experiment
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender-reference-head.py -- <canonical_face_model.obj> assets/reference
/Applications/Blender.app/Contents/MacOS/Blender --background assets/reference/tracked-reference-head.blend --python tools/blender-helmet.py -- assets/models
node tools/gen-face-mesh.mjs <canonical_face_model.obj> <vision_bundle.mjs> > src/face-mesh-data.js
```

## Git workflow (important)
- Work on a `claude/**` branch and push it. `.github/workflows/sync-main.yml` runs the tests and, **if they pass, merges the branch into `main` automatically**. `main` always holds the latest working version.
- `.github/workflows/ci.yml` runs the tests on `main` and on PRs.
- Commit messages end with the attribution lines given by the session. Never put model names in commits or code.
- The GitHub default branch may still be the first `claude/...` branch. The owner was told to switch it to `main` in Settings → General.

## Architecture (src/)
| File | Role |
|---|---|
| `main.js` | App controller: state, UI rendering, frame loop, onboarding, capture, error panel, context-loss recovery |
| `renderer.js` | WebGL2: one fragment shader for frame shapes (SDF), effects, face warps, segmentation masks; face-mask mesh pass; 3D layer composite |
| `vision.js` | MediaPipe pipeline (hands always; face + segmentation lazy), mask stabilizer, model retries |
| `tracker.js` / `tracker-worker.js` | Runs vision in a module Web Worker: back-pressure, watchdog, restart, main-thread fallback |
| `three-layer.js` / `accessories.js` | three.js 3D accessories on the head pose, MSAA render target, occluder |
| `guides.js` | In-app "make your own" guides (one per customisable tab, opened from a Guide chip and the Help panel) |
| `model-fit.js` | Fine-tune sliders for "Your 3D model" (offset, rotation, scale), saved per model |
| `masks.js` / `face-mesh-data.js` | UV-space face masks, template, face-swap alpha; generated canonical mesh data |
| `gestures.js` | One-hand signs (👍 ✌️ 🖐) from landmarks (2D or 3D world) |
| `one-euro.js` | One Euro filter + latency-compensating prediction |
| `temporal.js` | Temporal 3-frame vote for the segmentation mask |
| `onboarding.js` | Tutorial state machine + contextual hints |
| `errors.js` | Camera error mapping, constraint ladder, upload checks, retry/backoff, failure budget |
| `music/*` | Music mode (separate from effects, tabs Play, Band, Learn, Notes, Mix): `theory.js` scales and chords, `instruments.js` gesture → notes (8 instruments), `scheduler.js` look-ahead clock, `band.js` auto-accompaniment, `lessons.js` / `songs.js` (public domain only) / `learn.js`, `melody-import.js` ("Your melody": MIDI / audio / typed notes → lesson, notes kept on-device only), `looper.js`, `audio.js` engine (11 timbres, kits, MIDI), `pluck-worklet.js`, `controller.js` glue + overlay |
| `powers/*` | Superpower mode (tabs Powers, Style, Play, Feel): `catalog.js` the 16 powers (needs, hints, how-to), `abilities.js` one module per power, `controller.js` shared engine (lights, heat, scorch, shockwaves, hit tests, HUD), `gestures.js` charge / clap / circle / tracks / mask stats / pinch zoom, `fx-gl.js` WebGL passes (learned room, history ring, world pass, instanced glows), `particles.js`, `lightning.js`, `targets.js`, `sfx.js`. Loaded with `import()` on first use |
| `device.js` | Device tier → detection size, model cadence, camera resolution |
| `options.js` | UI options (values must match renderer/faces tables, checked by tests) |
| `faces.js`, `geometry.js`, `capture.js`, `art.js`, `styles.css`, `mediapipe.js` (pins MediaPipe 1.1.1) | helpers |

Root: `index.html` (import map for three@0.160.0), `sw.js` (service worker caching), `manifest.webmanifest`, `icon.svg`.

## Rules for this project
- **Original designs only.** Never recreate copyrighted or trademarked characters (Spider-Man, Iron Man, anime characters…) as built-in masks, accessories, textures, Blender models or adapted images. Offer original designs instead. Users may load their own files through "Your mask", "Face swap" or "Your 3D model".
- Music lessons use **public-domain melodies only**, stored as notes (never lyrics or copyrighted songs).
- Superpowers are **generic and original**: neutral names ("Energy wave"), never a character's signature move, name or look.
- Pure logic goes into small modules with unit tests (`tests/*.test.mjs`). Keep `npm test` green; CI and the auto-merge depend on it.
- Verify UI changes in headless Chromium with the fake-camera setup (`docs/TESTING.md`). The container has no GPU, so FPS figures there are meaningless.
- **Keep browser tests light** (the owner's Mac fan spins up otherwise): a tiny fake camera (320×180, 15 fps), `state.noTracking = true` when injecting data, one pass, no repeated runs. Prefer `tools/powers-smoke.cjs --only …` for the powers you changed.
- Pin CDN dependency versions (MediaPipe `1.1.1`, three `0.160.0`). If you bump one, bump `sw.js`'s cache `VERSION`.
- Be honest in reports: separate what was verified from what was only simulated.
