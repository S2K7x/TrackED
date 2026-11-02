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
| `main` auto-updated by GitHub Actions from `claude/**` branches after tests pass | Owner wanted `main` to always be up to date automatically |

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
| Instagram UI visible in test screenshots | The test webcam clip was a screen recording of a reel | Cropped clip. The app itself never adds such UI |

## Tuning results
- Frame filter: `minCutoff 2, beta 12`, from `tools/tune-filter.mjs` (sub-pixel jitter budget). At 1 px noise: jitter 0.44 px, lag with prediction 10.1 px RMS (was 11.2).
- Hands: confidence threshold 0.6; same-handed pair rejected when both scores > 0.85.
- Pinch-to-switch window: 0.7 s. Sign hold: 0.6 s. Frame collapse threshold: quad area < 0.0004.
- Reveal easing: ~0.25 s in, ~0.35 s out (exponential, frame-rate independent).
