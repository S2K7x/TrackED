# Decisions and lessons learned

## Architecture decisions
| Decision | Why |
|---|---|
| Static site, ES modules, no build step | Easy to run (`python3 -m http.server`), easy to host (GitHub Pages / any static host) |
| All effects in **one WebGL2 fragment shader** | No `getImageData` on the CPU; anti-aliased frame edges via inverse bilinear mapping + `fwidth` |
| Vision in a **module Web Worker** with one frame in flight | The UI never blocks; latency can't pile up |
| Face model + segmentation **lazy-loaded** and only run while a frame is visible (or a mask/3D is "always on") | They are the expensive models; they alternate frames when both are needed |
| **Device profile** (`device.js`) + runtime adaptation | Low-end phones get 320 px detection, a 480p camera and extras every 3 frames. Dynamic resolution and extras cadence adapt to measured FPS |
| Masks drawn in **canonical UV space** (MediaPipe canonical mesh) | One texture works on every face, and users can paint on a template |
| 3D with **three.js sharing the same WebGL context**, rendered into an **MSAA render target** then composited | Photos and recordings include the 3D; smooth edges without canvas antialiasing; smooth fades and an anti-aliased frame clip |
| Display modes for masks/3D: **Appear & disappear** (default), **Inside the frame**, **Always on** | Owner wanted accessories to appear in full when the frame passes over a face, with all three options available, and smooth transitions |
| 3D model fine-tune = an extra "fit" group between the reveal pop-in scale and the auto-fit, rotating around the anchor point | Live slider updates without rebuilding the model; the reveal animation keeps working |
| Fits stored per model, keyed by size + FNV-1a of the first and last 128 kB | Same file → same fit after reload, without hashing a 60 MB file; at most 20 models kept |
| Blender reference head in **metres, Z up, facing −Y**; "As modelled" anchor scales ×100 and skips the auto-fit | Blender's default units and glTF exporter (+Y up) give back MediaPipe's canonical space exactly (checked: exported bounds = canonical ÷ 100) |
| Blender models built by **scripts run in background Blender** (`tools/blender-*.py`) | Reproducible and reviewable; works even when the live Blender MCP connection (port 9876) isn't running |
| Ready-made models are `accessory` options with a `glb` path, fetched on first use and kept parsed per 3D layer | No download until picked; switching back is instant; their GPU data is never disposed while cached; a quick switch to another accessory during the download wins |
| Kitsune and Aero are mutually exclusive through a small `EXCLUSIVE` table in `options.js` | Owner wants them as two different looks; other masks and accessories stay combinable |
| Guides are plain data in `guides.js`, rendered into one shared dialog | Easy to edit; tests check every customisable tab has one and that they quote real UI labels and upload limits |
| One-hand signs from landmark geometry instead of MediaPipe Gesture Recognizer | Avoids a second model; signs are only read with one hand visible so they never clash with the frame |
| **Music mode is a separate mode** (Effects ↔ Music switch) with its own tabs and settings | The owner didn't want the modes mixed. In music mode the frame, masks, 3D, pinch-to-switch and one-hand signs are off, and only the hand model runs (lowest latency) |
| Music gestures handled in `onVision` (per tracking result), drawing and looper in the render loop | Notes fire as soon as landmarks arrive, and no gesture is missed when rendering is slow |
| All sounds synthesised (oscillators, noise, Karplus-Strong worklet), no samples | Nothing to download or license; tiny; any pitch |
| Scale locking by default (pentatonic) + visual guides | Free-air pitch is hard; this way beginners always sound good |
| Music has 8 instruments and 5 tabs (Play, Band, Learn, Notes, Mix) | Variety for experienced players, a gentle path (presets, Learn) for beginners |
| Band, arpeggio, sequencer, metronome and rhythm lessons share one **StepClock** with a 25 ms timer and 120 ms look-ahead on the audio clock | Sample-accurate grooves; timer jitter never reaches the sound; resyncs after a frozen tab instead of bursting |
| Lessons are pure state machines (`lessons.js`); the controller feeds them played events | Unit-testable; the same "feed" serves first steps, songs and rhythm games |
| Song lessons in **wait mode**; you hear the song first; stars instead of fail states | Beginners learn without stress (as in Synthesia's melody practice) |
| Rhythm timing windows of 70 / 140 ms | Webcam tracking adds ~33 ms of jitter; tighter windows would feel unfair |
| Songs: **public-domain melodies only**, notes only | No copyrighted music or lyrics in the app |
| Chord / arpeggio chords come from the scale's *parent* (pentatonic → major, blues → minor) | Pentatonic scales have no full triads |
| `npm run check` (`node --check` on every module) in CI before the tests | Catches syntax errors in browser-only files that unit tests never import |
| `main` auto-updated by GitHub Actions from `claude/**` branches after tests pass | Owner wanted `main` to always be up to date automatically |

| **Superpower mode is a third separate mode** (Effects · Music · Powers), loaded on first use | Same reasoning as music: no frame, masks or 3D; hands always, the light person segmenter or the face model only for powers that need them. `import()` keeps it out of the startup path |
| Powers are **original generic powers** with neutral names ("Energy wave", not a trademarked move) | Project rule: no copyrighted characters or signature moves. The gestures people know still work |
| Invisibility learns the room from the **person mask**, not a coloured cloth | No props needed. Pixels near you are never learned (dilated mask), never-seen pixels shimmer like heat haze instead of showing a hole |
| `selfie_segmenter` (250 KB) for powers instead of the multiclass model | Several times faster and 60× smaller; powers only need person vs background, soft edges come from its confidence mask + mipmaps |
| Two GPU passes per frame for every power: one full-screen "world" pass, one instanced glow draw | One shader handles all warps and compositing (branches are uniform, so cheap); all glows share one buffer upload and one draw call. "Screen" blending keeps colours readable over bright rooms |
| CPU particles (structure of arrays, swap-remove), not transform feedback | ≤ 4000 particles; emission follows the hands; ~2 ms of JS per frame in total |
| Gestures read on every tracking result, simulation and drawing on every frame | Same split as music: triggers never miss a short gesture, motion stays smooth |
| Pinch requires the index **not curled** | A fist's thumb rests on the folded index: without this, fists read as pinches (caught by a unit test) |

## Bugs found and fixed (worth remembering)
| Bug | Cause | Fix |
|---|---|---|
| Frame never shown on slow devices | Liveness was based on capture time, not arrival time | Visibility based on consecutive missed detections |
| Stray lines across the screen | Outer glow used spurious roots of the inverse bilinear solve | Only trust (u,v) near the frame and when `fwidth` is small |
| Second MediaPipe task fails in the worker (`ModuleFactory not set`) | ES-module loader cached; factory only set once | `self.import` hook reusing the factory |
| Masks not shown | Face data TTL (0.6 s) shorter than the face-model period on slow devices | TTL adapts to the tracking rate |
| One Euro velocity overestimated | Derivative taken on the filtered value | Use the raw signal (as in the paper) |
| Mask stabilizer could lock a pixel / read a recycled buffer | History stored corrected masks and was overwritten before being read | History holds raw masks, single-pass read-then-recycle |
| Watchdog killed a healthy worker | WASM compile during model warm-up blocks the worker for seconds | Worker reports `loading`; watchdog ignores slow frames while loading |
| Name clash `maskTex` | Segmentation and face-mask textures shared a field | Renamed `faceMaskTex` |
| Fit restore looked broken in a browser test | `accessory` is persisted as "model", so the test stopped waiting before the reloaded file was parsed | Tests wait for `three.userModel`, not the setting |
| Kitsune ears drawn above the forehead were invisible | The face mesh stops at the hairline (UV oval top ≈ v 0.11); paint outside the oval is never sampled | Ears painted inside the oval; masks are previewed on the Blender reference head (its UVs match the app) |
| Music gestures missed (1 note out of 3 pinches in a test) | Gesture detection ran at the render rate and sampled the hands only when a frame was drawn | Detection moved to `onVision` (every tracking result); test now gets 3/3 pinches, 6/6 drum strikes |
| Looper replayed missed notes in a burst after a pause | The cursor advanced by at most one loop per call, so it fell behind real time | After a gap longer than the loop, jump to the present |
| WebGL "feedback loop" error the first time a power used the learned room | Creating a texture binds it to the *active* unit; the new plate replaced the camera on unit 0, then was rendered into while sampled | Textures are created on a spare unit (15) |
| Power-up aura covered the whole body in white | The blurred "outer" mask didn't exclude the body itself | Glow × (1 − body mask) |
| Instagram UI visible in test screenshots | The test webcam clip was a screen recording of a reel | Cropped clip. The app itself never adds such UI |

## Tuning results
- Frame filter: `minCutoff 2, beta 12`, from `tools/tune-filter.mjs` (sub-pixel jitter budget). At 1 px noise: jitter 0.44 px, lag with prediction 10.1 px RMS (was 11.2).
- Hands: confidence threshold 0.6; same-handed pair rejected when both scores > 0.85.
- Pinch-to-switch window: 0.7 s. Sign hold: 0.6 s. Frame collapse threshold: quad area < 0.0004.
- Reveal easing: ~0.25 s in, ~0.35 s out (exponential, frame-rate independent).
