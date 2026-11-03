# TrackED

Frame the world with your fingers. Make an **L with the thumb and index of each hand** and a live frame appears between your hands. Everything inside it changes in real time: your face, your friends, the room. The frame follows your hands as they move, tilt and stretch.

Everything runs in the browser, on your device. No video leaves it.

## Quick start (for testers)

**On a computer**
```bash
git clone https://github.com/S2K7x/TrackED.git
cd TrackED
npm start                 # serves the app at http://localhost:8000 (Node, no install needed)
```
Open **http://localhost:8000** in Chrome, Edge, Safari or Firefox, click **Start camera** and allow the camera.
After a `git pull`, a normal reload shows the new version (`npm start` tells the browser to recheck every file). If you served the app another way and still see the old version, do a hard reload (<kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>).

**On a phone.** The camera only works on `https://` pages, so expose your local server over HTTPS:
```bash
npx localtunnel --port 8000        # or: cloudflared tunnel --url http://localhost:8000
```
Open the `https://…` URL it prints on your phone. Tip: Add to Home Screen gives a full-screen app.

**First launch.** A 4-step interactive tutorial starts automatically:
1. Show both hands.
2. Make an L with each hand.
3. Change the effect.
4. Try a one-hand sign.

Each step validates itself as soon as you succeed. You can skip it and replay it any time from **?** (or the <kbd>?</kbd> key).

**Troubleshooting**

| Problem | Fix |
|---|---|
| "Camera access was blocked" | Click the camera icon in the address bar → Allow, then **Try again**. |
| "The camera is busy" | Close other apps that use the camera (video calls, camera app). |
| Black screen on a phone | Make sure the URL is `https://`. |
| The frame doesn't appear | Good light, both hands fully in view, about an arm's length away. The app shows tips when it detects darkness, no hands or one hand. |
| Slow on an old phone | The app lowers its resolution and model cadence by itself. Avoid combining segmentation (Target), masks and 3D at the same time. |
| Tracking points / FPS | Press <kbd>D</kbd> or the dots button: render fps, tracking fps, latency and resolution. |

Run the unit tests with `npm test` and the syntax check of every module with `npm run check` (Node 20+).

**Branches.** `main` always holds the latest working version. Every push to a work branch (`claude/**`) runs the tests in GitHub Actions and, if they pass, merges into `main` automatically (`.github/workflows/sync-main.yml`). The CI (`.github/workflows/ci.yml`) also runs the tests on `main` and on pull requests.

## Docs
- [`docs/RESEARCH.md`](docs/RESEARCH.md): research log with sources (ML papers, techniques, UX)
- [`docs/DECISIONS.md`](docs/DECISIONS.md): technical decisions, bugs found, tuning results
- [`docs/ROADMAP.md`](docs/ROADMAP.md): next steps and what to verify on real devices
- [`docs/TESTING.md`](docs/TESTING.md): unit tests, headless browser with a fake camera, failure injection
- [`CLAUDE.md`](CLAUDE.md): context loaded automatically by Claude Code sessions

## Features
The bottom sheet has five tabs:

| Tab | Options |
|---|---|
| **Effect** | None, Neon, Tint, Thermal, Cartoon, Glitch, Pixel, Kaleido, Loupe ×2, Invert, Mono, Image (plus your own image) |
| **Face** | Big eyes, Big mouth, Alien, Balloon head, Tiny face, Swirl, Laser eyes, Anonymize. Applied to **everyone**, **me** (the closest face) or **others** (up to 4 faces), and only while they are inside the frame |
| **Mask** | Face masks that follow your face in 3D: Wireframe, Visor, Skull, Gold, Feline, War paint, Kitsune (a porcelain fox mask inspired by the Japanese folk tradition: eye wings, forehead ears, flaming jewel and cheek flames in your colour) (all original designs; Kitsune and the Aero helmet are never worn together, picking one switches the other off), **Your mask** (any image painted on the downloadable template) and **Face swap** (pick a photo: its face is mapped onto yours with live lighting). Three display modes (shared with 3D): **Appear & disappear**, **Inside the frame** or **Always on** (see below) |
| **3D** | 3D accessories locked to your head pose: Crown, Halo, Shades, Horns, Party hat, Mohawk, Cat ears (original models built from primitives), **Aero helmet** (an original Blender model, downloaded on first use), or **your own `.glb` model** placed on the head, on the eyes, around the head or **as modelled** on the Blender reference head, at 75 to 150% size, then fine-tuned with sliders (offset, rotation, scale; saved per model) |
| **Target** | Limits the colour effect to: Everything, People, Background, Skin, Hair or Clothes (person segmentation) |
| **Shape** | Rectangle, Rounded, Ellipse, Circle, Heart, Star, Diamond |
| **Color** | 9 presets plus a custom picker (drives Neon, Tint, the border and laser eyes); neon, animated rainbow, thick or no border |
| **More** | Capture timer (off / 3 s / 10 s) and the pinch gesture |

Hands-free features (both hands are busy making the frame):
- **Capture timer**: 3, 2, 1 countdown before a photo or a recording starts. Tap again or press Esc to cancel.
- **Pinch to switch**: close the frame (thumbs and indexes together) and reopen it within 0.7 s to jump to the next effect.
- **One-hand signs** (only read when a single hand is visible, so they never clash with the frame): hold 👍 to take a photo, ✌️ for the next effect, 🖐 to freeze or unfreeze. A ring fills while you hold the sign, which fires after 0.6 s and only once per sign. Classification is pure geometry on the 21 hand landmarks (finger joint angles and distances), so it needs no second model.
- **Freeze**: the picture inside the frame freezes while the live scene keeps moving around it. Move the frozen window across the room.

The top bar has **photo**, **video recording** (MP4 when the browser supports it, WebM otherwise, with the native share sheet on mobile), **camera switch** and **tracking points**. The last one shows the detected points and a HUD with render and tracking FPS.
You can also swipe left or right on the video to cycle effects. Settings are remembered.

## Phone vs desktop
| | Phone | Desktop |
|---|---|---|
| Layout | Edge-to-edge camera (like a camera app), floating glass controls, bottom sheet with one scrolling row | Video as a rounded card, settings in a right sidebar with titled sections and tile grids, hover states |
| Input | Swipe on the video to change effect, haptic feedback (Android) | Keyboard: ← → effects, P photo, R record, F freeze, D tracking, Esc cancel timer |
| Camera | Portrait stream requested in portrait | 16:9 stream |
| Extras | Screen kept awake while filming (Wake Lock), installable to the home screen (web manifest) | |

Performance adapts to the device (`src/device.js`): phones with few cores or little memory send smaller frames to the models (320 px against 480 px on desktop), use a 480p camera and run face/segmentation once every 3 frames. At runtime, if tracking drops below 12 fps, the heavy models run even less often, and the rate recovers when tracking does.

## Design
The UI is light and airy: a warm off-white canvas with soft colour fields, frosted-glass panels, gradient preview tiles, thin line art and a single lime accent. The font is [Urbanist](https://fonts.google.com/specimen/Urbanist). The camera feed sits in a rounded card. On the intro page, the line-art wave bundle is an animated SVG generated in `src/art.js`. Background colour fields are plain radial gradients rather than blurred layers, which keeps compositing cheap, and the glass blur is lighter over live video.

## Architecture
| File | Role |
|---|---|
| `index.html`, `src/styles.css` | Markup and styles |
| `src/main.js` | Main loop, frame state, UI |
| `src/options.js` | Options shown in the UI (labels, preview tiles, icons) |
| `src/art.js` | Decorative SVG line art |
| `src/vision.js` | MediaPipe pipeline: hands (always), faces and segmentation (loaded on demand) |
| `src/tracker.js` + `src/tracker-worker.js` | Runs the vision pipeline in a **Web Worker** (falls back to the main thread) |
| `src/renderer.js` | **WebGL2** renderer: shapes, effects, face warps and masks in a single fragment shader |
| `src/faces.js` | Face anchors (eyes, mouth, nose, size), me/others selection, segmentation categories |
| `src/capture.js` | Photo and video capture of the canvas |
| `src/masks.js` | Built-in masks painted in UV space, mask template, face-swap fade |
| `src/face-mesh-data.js` | Generated canonical mesh data (UVs, triangles, contours) |
| `tools/gen-face-mesh.mjs` | Generator for the mesh data |
| `src/three-layer.js` | three.js layer: head pose, camera, occluder, pose smoothing, user models |
| `src/accessories.js` | Built-in 3D accessories |
| `src/guides.js` | In-app "make your own" guides, one per customisable tab |
| `src/model-fit.js` | Fine-tune values for "Your 3D model", clamping and per-model storage |
| `src/gestures.js` | One-hand sign classifier (👍 ✌️ 🖐) and hold debouncing |
| `sw.js` | Service worker: model / library caching, offline |
| `src/temporal.js` | Temporal stabilisation of the segmentation mask |
| `tools/tune-filter.mjs` | One Euro tuning experiment (jitter vs lag) |
| `src/errors.js` | Camera error mapping, constraint ladder, upload checks, retry with backoff, failure budget |
| `src/onboarding.js` | Interactive tutorial state machine and contextual hints |
| `src/music/theory.js` | Scales, note names, pitch mapping with snapping |
| `src/music/instruments.js` | Gesture → note detection: pinch keys (hysteresis), string crossings, pad strikes, theremin |
| `src/music/looper.js` | Free-length loop recorder |
| `src/music/audio.js` / `pluck-worklet.js` | Web Audio engine (synth voices, drums, theremin, reverb, echo, limiter, MIDI out) and Karplus-Strong worklet |
| `src/music/controller.js` | Music mode: hands → instruments → audio, band and lessons, on-screen overlay |
| `src/music/scheduler.js` | Look-ahead step clock ("A tale of two clocks") |
| `src/music/band.js` | Backing band: grooves, bass and stabs that follow the progression |
| `src/music/lessons.js` / `songs.js` / `learn.js` | Wait-mode song lessons, rhythm games, first steps; public-domain melodies; music-basics cards |
| `src/music/melody-import.js` | "Your melody": MIDI parser + melody-track pick + skyline, YIN pitch tracking and note segmentation, typed notes, key finding, fit to the instrument |
| `src/device.js` | Device profile: mobile/desktop, performance tier, detection size, model cadence |
| `src/powers/catalog.js` | The 16 superpowers: labels, tiles, gestures, how-to text, which models each one needs |
| `src/powers/abilities.js` | One small module per power (gesture + per-frame simulation + optional HUD) |
| `src/powers/gestures.js` | Hand tracks with velocity and growth, energy charge, clap, air circle, triggers, face aim, body position from the mask, two-hand pinch zoom, spring |
| `src/powers/controller.js` | Superpower mode engine: hand tracks, shared helpers (lights, heat, scorch, shockwaves, hit tests), title card, training HUD |
| `src/powers/fx-gl.js` | WebGL2 passes: learned background, frame history ring, the world pass (warps, heat, lights, scorch, frost, moved / resized you, invisibility, time stop, afterimages, clones, portals, aura, cinematic look), one instanced glow draw |
| `tools/powers-smoke.cjs` | Light headless smoke test of every power (tiny fake camera, tracking off, injected data) |
| `src/powers/particles.js` / `lightning.js` / `targets.js` / `sfx.js` | CPU particle pool + glow batch, procedural lightning, training targets, synthesised sound effects |
| `src/one-euro.js` | **One Euro filter** that smooths landmarks without lag |
| `src/geometry.js` | Builds the quad between the two hands |

## Face masks: how they work
- MediaPipe Face Landmarker returns a 468-point face mesh. `tools/gen-face-mesh.mjs` takes MediaPipe's [canonical face model](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj) (Apache-2.0) and generates `src/face-mesh-data.js` with:
  - the UV layout of every landmark,
  - 898 triangles,
  - ordered contours (face oval, eyes, lips, brows).
  The `v` and `vt` records in the OBJ are ordered differently, so each landmark's UV is recovered from the face records, as described in [this Codrops write-up](https://tympanus.net/codrops/2026/09/06/building-a-real-time-3d-face-mask-with-mediapipe-threlte-and-three-js/).
- Every mask is an RGBA texture in that UV space. A second WebGL pass draws the mesh at the live landmark positions with that texture:
  - **Back-face culling** hides the far side of a turned head. The on-screen winding comes from a reference triangle around the nose, so it also works with the mirrored selfie view.
  - **Live lighting** modulates the mask with a low-pass of the camera image, so shadows and highlights carry over.
  - **Frame clipping** uses the same shape SDF code as the frame, so the mask only appears inside the frame.
- **Your mask:** download the template (mesh wireframe, eyes, lips), paint on it in any editor, export a PNG with transparency, and load it.
- **Face swap:** the photo goes through MediaPipe in IMAGE mode, and its own landmarks become the texture coordinates. Per-vertex alpha fades the outline and opens the eyes and mouth, so the live eyes blink and the mouth talks. A local colour transfer (live low-pass ÷ photo low-pass) matches skin tone and lighting.
- **Smoothing:** meshes go through a One Euro filter, with one filter bank per face. On slow devices the last face is kept for about 3 model updates, so masks don't flicker.

## Onboarding
Designed after hand-tracking onboarding guidance from [Meta](https://developers.meta.com/vr/design/hands-onboarding-best-practices/) and [Ultraleap](https://docs.ultraleap.com/xr-guidelines/Getting%20started/tutorials_hints_tip.html), plus permission-priming practice ([uxcel](https://uxcel.com/lessons/ask-permission-best-practices-607)):
- **Permission priming.** Before the browser's camera prompt, one sentence explains why the camera is needed and that nothing leaves the device.
- **Startup checklist.** "Camera" and "Hand tracking model" each show loading, ready or failed, so a slow first model download never looks like a frozen app.
- **Learn by doing.** Each tutorial step shows a neutral line-art hand animation, stays until you actually perform the gesture (validated from live tracking), then confirms with "Nice!". It can be skipped, is remembered, and can be replayed from the help panel.
- **Contextual hints** (after the tutorial, one at a time, with a cooldown): too dark (measured camera brightness), no hands for 6 s, only one hand for 5 s, hands too close.
- **Make-your-own guides.** Every customisable tab (Effect, Mask, 3D, Color) has a **Guide** chip that opens step-by-step instructions for a perfect result with your own image, mask, face swap, 3D model or colour (template rules, export settings, size limits, Blender workflow). The Help panel links to all of them. Content lives in `src/guides.js`.
- **Help panel** (`?`): the frame, signs, masks and 3D, keyboard, tracking tips and capture, plus a "Replay the tutorial" button.
- **Accessibility.** Visible keyboard focus everywhere, labelled icon buttons, `aria-live` regions for status and tutorial, dialog semantics, and `prefers-reduced-motion` turns animations off.

## Smart and smooth: tracking quality and performance
- **Latency compensation.** The camera-to-result delay is measured continuously (moving average). On every rendered frame, the frame's corners are pushed forward along their One Euro filtered velocity by "latency + time since the last result", with a cap of 80 ms. The frame stays glued to the hands instead of trailing behind them. Filtering removes jitter and prediction removes lag, the usual pairing described in the [1€ filter](https://cristal.univ-lille.fr/~casiez/1euro) literature. The One Euro derivative is taken on the raw signal, as in the original paper.
- **Edge-aware segmentation.** The low-resolution category mask is refined with a 3×3 joint bilateral filter guided by the camera colours, the approach [Google Meet uses](https://research.google/blog/background-features-in-google-meet-powered-by-web-ml/). Effect edges follow hair and shoulders instead of blocky mask pixels. Low-end phones skip the refinement.
- **Hand confidence and handedness.** MediaPipe Hands ([Zhang et al., 2020](https://arxiv.org/abs/2006.10214)) outputs a handedness label and confidence for each hand. Hands under 0.6 are dropped as false positives. Two confident hands with the *same* handedness (two people, or a misdetection) never build a frame.
- **3D signs.** One-hand signs are judged on MediaPipe's metric *world* landmarks when available. Finger joint angles are then measured in true 3D, so a hand turned towards the camera, whose fingers look short in the image, is still read correctly.
- **Segmentation without flicker.** A 3-frame temporal vote runs on the category mask in the worker. A pixel that flips class for a single frame, while the two previous raw frames agree, keeps its class. Real changes go through on their second frame. It is classic change-detection stabilisation, with no motion estimation, as advocated for real-time video segmentation (see Google's [mobile real-time video segmentation](https://research.google/blog/mobile-real-time-video-segmentation/)).
- **Filter tuned by measurement, not by eye.** `tools/tune-filter.mjs` follows Casiez et al.'s procedure (CHI 2012). It simulates landmarks at 30 Hz with 1 px and 2.5 px of noise, still and moving at up to ~1.1 image widths per second, then picks the setting with the least lag (prediction included) within a sub-pixel jitter budget (≤ 0.5 px). Result: `minCutoff 2, beta 12` gives about 10% less lag than the previous `1.5, 8` (10.1 against 11.2 px RMS at 1 px noise) for +0.05 to 0.13 px of jitter. The same experiment shows that with heavy noise (dim light), no setting meets the jitter budget without large lag, which is the physical limit of the trade-off.
- **Dynamic resolution.** If rendering stays under 22 fps for 3 s, the internal resolution drops by 15% steps (down to 55%). It climbs back once rendering holds 28 fps.
- **Power saving.** With no hand in view for 3 s, tracking runs every other frame. A hand coming back is picked up within about 70 ms.
- **Warm-up.** On mid and high-tier devices, the face model loads in the background during idle time, so the first mask, face filter or 3D accessory appears instantly.
- **Offline and instant reloads.** A service worker (`sw.js`) caches the MediaPipe WASM, the models, three.js and the fonts (cache-first, since the URLs are versioned). The app's own files are network-first so updates arrive immediately, with an offline fallback.
- The tracking HUD (D) shows render and tracking fps, latency, render scale and the face/segmentation cadence.

## Music mode
A separate mode (switch **Effects → Music** at the top of the panel, or press <kbd>M</kbd>) with its own tabs: **Play · Band · Learn · Notes · Mix**. The frame, masks and 3D are off, only the hand model runs (lowest latency), and your hands play an instrument. Every sound is synthesised in the browser: no samples, no recordings.

| Instrument | How to play |
|---|---|
| **Theremin** | The right hand's height plays the notes along on-screen "frets", the left hand sets the volume. Pitch can be locked, soft-snapped or free. |
| **Keys** | Pinch your thumb with a finger: 4 notes per hand, sustained while you pinch. |
| **Harp** | Sweep a fingertip across 10 strings. Speed sets the loudness (Karplus-Strong plucks in an AudioWorklet). |
| **Drums** | Six pads, struck with a quick downward fingertip tap. |
| **Chords** | Left hand: show 1 to 4 fingers to pick a chord of the progression. Right index: strum up or down across the line. |
| **Arp** | Left hand picks the chord, right hand height sets the arpeggio speed (quarters, 8ths, 16ths), locked to the tempo. |
| **Beats** | 4 × 8 step sequencer: point at a cell with your right index and pinch to switch it on or off. It loops at the tempo. |
| **DJ** | A house groove plays. Right hand left–right opens a low-pass filter, up adds echo. Pinch your left hand to drop the drums. |

- **11 sounds.** Glass, E-piano (FM), Marimba (FM), Pluck (Karplus-Strong), Organ (additive), Strings, Brass, Choir (formant "ah"), Synth, Pad, 8-bit.
- **Band.** An auto-accompaniment (drums, bass, chord stabs) that follows a chord progression in your key. Six styles (Pop, Lo-fi, House, Rock, Reggae, Hip-hop), five progressions (I–V–vi–IV, I–vi–IV–V, vi–IV–I–V, 12-bar blues, I–IV), tempo, metronome, three drum kits (acoustic, electro 808, lo-fi). Everything is scheduled on the audio clock.
- **Jam presets.** One tap: Chill lo-fi, Pop star, Dance floor, Blues jam, Dreamy, Arcade.
- **Learn** (for people who have never played):
  - **First steps.** 3 guided steps for each instrument, each validated by what you actually play.
  - **Songs in wait mode.** Twinkle Twinkle, Mary Had a Little Lamb, Frère Jacques, Ode to Joy, When the Saints, the C major scale. You hear the song first, then the next note glows and the song waits until you play it. Stars at the end, best score saved. Only public-domain melodies, stored as notes (no lyrics).
  - **Your melody.** Found a tune you like? Press **＋ Your melody** and import it as a **MIDI file** (exact notes; the melody track is picked for you), an **audio file** of one voice or instrument, a **recording** (hum, sing or whistle it, up to 20 s), or **type the notes** (`C D E:2 -` or `do ré mi`). TrackED finds the key, moves the tune to C so it fits the instrument, and teaches it in wait mode like the built-in songs. Only the notes are kept, in this browser; nothing is uploaded. Full songs with a band can't be transcribed yet (see `docs/ROADMAP.md`).
  - **Rhythm games.** A count-in, then rings close onto the pads. Hits are judged perfect, good or missed, with windows sized for webcam tracking.
  - **Music basics.** Your first minute of music; notes, scales and keys; chords and progressions; rhythm and beats.
- **Notes.** Scale (pentatonic by default: you can't play a wrong note), key, range, theremin snapping.
- **Mix.** Reverb, echo, MIDI output to a DAW (Web MIDI).
- **Looper** (<kbd>L</kbd>) records a phrase and loops it. Videos recorded in music mode include the sound.

## Superpower mode
A third mode (switch to **Powers** at the top of the panel, or press <kbd>S</kbd>) with its own tabs: **Powers · Style · Play · Feel**. Pick a power: a title card shows it, the status line tells you its gesture, and **How to use your powers** explains them all. Hold 👍 for a moment to jump to the next power without touching anything. Everything is drawn on the WebGL canvas, so photos and videos include the effects and their sounds. All designs are original: generic comic-book powers, not any character's signature move.

| Power | Gesture |
|---|---|
| **Energy wave** | Hold both hands close together, as if holding a ball: energy charges between your palms (a ring shows the charge). Throw them sideways for a beam, or open them for a blast at the camera. |
| **Lightning** | Open fingers crackle; both hands make arcs jump between them; pinch to throw a bolt where your index points. It scorches the spot it hits. |
| **Pyro** | Open hand = flames, fist = embers, quick flick = a fireball that explodes and leaves a burn mark. |
| **Frost** | Hold a palm still: frost crystals spread on the picture around it. Both palms still: the screen freezes over from the edges. Flick: an ice shard that shatters. |
| **Force** | Open palm bends space like a lens; push your palm at the camera for a shockwave; pinch for a black hole. |
| **Shield** | Raise an open palm: a hexagonal force field. Poke it with your other hand to make it ripple, push it for a shockwave. |
| **Reality warp** | Pinch the picture and pull: the room stretches like putty and springs back with a wobble when you let go. Two hands, two grabs. |
| **Invisibility** | Hold an open palm still for a second. The room behind you shows through (TrackED learns it while you're not in front of it). Looks: shimmer, clear or ghost. |
| **Time stop** | Clap: the room freezes and turns cold, you keep moving, drops hang in the air (push them with your fingers). |
| **Speedster** | Colourful afterimages trail behind you, brighter when you move fast. |
| **Clones** | Hold ✌️: 2 or 4 copies of you appear, with contact shadows, and copy your moves a split second later. |
| **Teleport** | Point left or right and hold still: you blink a third of the picture away (the room fills the spot you left). Point up to come back. |
| **Size shift** | Pinch with both hands and spread them to grow, bring them together to shrink, like zooming a photo. Two fists: normal size. |
| **Laser vision** | Open your mouth: beams shoot from your eyes, aimed by turning your head, and burn a trail on the wall. |
| **Portal** | Draw a circle in the air with your index: a swirling portal opens behind you; a fist inside closes it. |
| **Power up** | Clench both fists: an aura flares around your silhouette, sparks rise, the picture shakes. |

- **Realism**: every power **lights the real room** (a camera pixel is roughly albedo × light, so added light scales the pixel: your hands, face and the walls take its colour), hot things make the air shimmer (heat haze), impacts leave **scorch marks** that glow and cool to soot, big hits shake the camera with a touch of chromatic aberration, and moved or resized silhouettes get a **light wrap** from the room so they don't look pasted on.
- **Style**: colour, intensity (Subtle, Strong, Epic), camera look (**Natural** or **Cinematic**: teal-and-orange grade, letterbox, grain, vignette) and the invisibility look.
- **Play**: **Training** (60-second rounds; targets get more numerous and faster, golden targets are worth ×3, combos multiply the score, best score saved), the hands-free 👍 switch, invisibility / time stop / clones with a gesture or always on, 2 or 4 clones.
- **Feel**: synthesised sound effects (also in recorded videos), screen shake and lens effects, and **Photo of big moments** (a photo at the peak of a blast, explosion, time stop, teleport…). Phones vibrate on big moments.
- **How it stays fast**: hands always; the light person segmenter (~250 KB) only for powers that need your silhouette, the face model only for laser vision. The whole look is two GPU passes: one full-screen pass for every warp, light and composite, and one instanced draw call for every particle, beam, bolt, orb, ring and shield. About 2 ms of JavaScript per frame in a headless test.

## Robustness and error handling
Every failure the app can hit in the real world has a defined behaviour, and each one was verified by injecting it in a browser:

| Failure | What happens |
|---|---|
| Camera blocked / missing / busy / unsupported | A clear panel says what happened and what to do, with a "Try again" button. Standard and legacy Chrome error names are both recognised ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [common errors](https://blog.addpipe.com/common-getusermedia-errors/)). |
| Camera can't satisfy the requested mode | Automatic retry down a ladder: ideal resolution, then 640×480, then any camera with the right facing, then any camera. |
| Camera unplugged or taken mid-session | The track's `ended` event shows the panel, and Retry reconnects without reloading. |
| Page not secure (http) | Explained upfront (the camera requires https or localhost). |
| WebGL context lost (GPU reset, driver update, memory pressure) | `preventDefault()` on `webglcontextlost`, rendering pauses, then every GPU resource is rebuilt on `webglcontextrestored`: shaders, textures, your image, masks, the 3D layer and your 3D model ([Khronos guidance](https://wikis.khronos.org/webgl/HandlingContextLost)). |
| Tracking worker crashes or stalls | A watchdog notices a frame that never comes back and restarts the worker. After 2 restarts, tracking moves to the main thread. Model loading is reported by the worker, so a slow WASM compile is never mistaken for a stall. |
| Model download fails | Retried with exponential backoff (1 s, 2 s) on network errors. The GPU delegate falls back to CPU on other errors. |
| MediaPipe timestamps | Always strictly increasing, as VIDEO mode requires. |
| Bad uploads | Type and size are checked before decoding (images up to 25 MB, `.glb` up to 60 MB). Corrupt files and multi-file `.gltf` get a specific message, and huge images are downscaled to the GPU's max texture size. |
| Photo / recording failures | `toBlob` / `MediaRecorder` errors, empty clips and storage-full errors are reported. A recording in progress is saved when the page is hidden. |
| A frame throws | Logged and skipped. If 60 frames in a row fail, the loop stops and the panel offers a reload instead of spinning. Uncaught errors are logged and shown at most once every 5 s. |
| Older Safari without `createImageBitmap` resize | Frames are downscaled through an `OffscreenCanvas` instead. |
| Switching 3D accessories | The previous accessory's geometries, materials and textures are disposed, so there is no GPU memory leak. |

## Display modes for masks and 3D
| Mode | Behaviour |
|---|---|
| **Appear & disappear** (default) | When the frame passes over a face (2 of eyes/nose inside it), that face's mask and accessory fade and pop in **in full**, even the parts outside the frame such as a crown above the head. They fade out when the frame leaves. Easing is exponential and frame-rate independent (about 0.25 s in, 0.35 s out), and accessories grow with a slight overshoot. |
| **Inside the frame** | Only the part inside the frame shape is visible, with an anti-aliased edge, so the frame works like a window. |
| **Always on** | Visible all the time, even without a frame. |

## 3D accessories: how they work
- The Face Landmarker runs with `outputFacialTransformationMatrixes`. For each face it returns a 4×4 head pose that maps the canonical face model (centimetres, y up, z towards the camera, origin near the centre of the head) into camera space.
- A three.js `PerspectiveCamera` with a 63° vertical field of view (MediaPipe's virtual camera) projects that pose onto the video. In testing, the projected canonical nose tip landed within 0.5% of the detected nose landmark.
- **One shared WebGL context.** three.js renders the accessories into a **multisampled (MSAA ×4) render target**. The 2D renderer then composites that layer (premultiplied alpha) with the fade and, in "Inside the frame" mode, an anti-aliased clip to the frame shape. Edges stay smooth even though the main canvas has no antialiasing, and photos and recordings include the 3D. Low-end phones skip MSAA. Both renderers reset GL state before drawing.
- **Head occluder.** An invisible, depth-only ellipsoid sits where the head is, so the back of a crown, the arms of the glasses or a hat brim correctly disappear behind your head.
- **Pose smoothing.** Position follows faster when you move fast and smooths more when you are still. Rotation uses an adaptive slerp.
- **Your own models.** Load a `.glb` file (Draco-compressed meshes are supported). It is centred, scaled to the head and anchored on the head, on the eyes or around the head.
- **Fine-tune.** Once a model is loaded, the 3D tab shows sliders for left/right, down/up, back/front (cm), tilt, turn, roll (degrees) and scale. Changes apply live and the model shows on your face for a few seconds while you adjust, whatever the display mode. The fit is saved per model file (keyed by a hash of the file), so loading the same `.glb` again restores it. Double-click a slider to reset that value.
- **Blender reference head.** "Download Blender head" in the 3D tab gives `assets/reference/tracked-reference-head.blend`: the exact face surface the app tracks (MediaPipe's canonical face, real size, facing −Y) plus a skull guide and landmark markers. Model your hat, helmet or glasses around it, export a `.glb` (+Y up, the default), load it and pick **As modelled (Blender head)**: it sits exactly where you modelled it. Objects named `TrackED_Reference*` are ignored if you forget to hide them. See `assets/reference/README.md`. A ready-made original helmet, **Aero**, is built in (3D tab) and its source is in `assets/models/`.
- three.js (`three@0.160.0`, through an import map) is only downloaded the first time a 3D option is picked.

## How it works
- **Rendering is fully on the GPU.** The camera frame is a texture. For each pixel, the shader inverts the bilinear mapping of the frame quad to get (u, v) inside the frame. That gives anti-aliased edges, a glowing border and a perspective-warped overlay image, without any `getImageData`.
- **Shapes** are signed distance functions (Inigo Quilez's 2D SDFs) evaluated in the frame's (u, v) space. `fwidth()` converts the distance to screen pixels for a crisp edge on every shape.
- **Faces** use [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js), 478 points including the irises. Only the eyes, mouth, nose and face size are sent to the shader. The warps (radial magnify, pinch, swirl) remap the texture lookup inside the frame only.
- **Targets** use [MediaPipe Image Segmenter](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter) with `selfie_multiclass_256x256`: background, hair, body skin, face skin, clothes and accessories. The category mask is uploaded as an R8 texture, and a bitmask selects the categories to change.
- **Tracking runs off the main thread.** Frames are downscaled to 480 px and transferred as `ImageBitmap` without copying. At most one frame is in flight; newer frames are dropped instead of queued, so latency never piles up.
- **`requestVideoFrameCallback`** processes every camera frame exactly once.
- **Cost control.** The face and segmentation models download on first use and only run while a frame is on screen. When both are active, they alternate frames.
- **One Euro filter** gives strong smoothing when the hands are still (no jitter) and light smoothing when they move fast (no lag).
- **Multiple MediaPipe tasks in a module worker.** MediaPipe normally loads only one task there (`ModuleFactory not set`). A `self.import` hook reuses the WASM factory for every task.

## References
- F. Zhang et al., *MediaPipe Hands: On-device Real-time Hand Tracking*, 2020. [arXiv:2006.10214](https://arxiv.org/abs/2006.10214)
- I. Grishchenko et al., *Attention Mesh: High-fidelity Face Mesh Prediction in Real-time*, 2020. [arXiv:2006.10962](https://arxiv.org/abs/2006.10962)
- G. Casiez, N. Roussel, D. Vogel, *1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems*, CHI 2012. [project page](https://cristal.univ-lille.fr/~casiez/1euro)
- Google Research, [Background Features in Google Meet, Powered by Web ML](https://research.google/blog/background-features-in-google-meet-powered-by-web-ml/) (joint bilateral mask refinement)
- Google Research, [Mobile Real-time Video Segmentation](https://research.google/blog/mobile-real-time-video-segmentation/) (temporal consistency on mobile)
- Superpowers: see the "Superpower mode" section of [`docs/RESEARCH.md`](docs/RESEARCH.md) (clean plate, lightning, shockwaves, particles, synthesised sound)

## Credits
- Face, hand and segmentation models and the canonical face mesh: [Google MediaPipe](https://github.com/google-ai-edge/mediapipe), Apache License 2.0.
- 2D signed distance functions: Inigo Quilez.
- 3D rendering: [three.js](https://threejs.org), MIT License.
