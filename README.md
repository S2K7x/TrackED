# TrackED

Frame the world with your fingers. Make an **L with the thumb and index of each hand** and a live frame appears between your hands. Everything inside it changes in real time: your face, your friends, the room. The frame follows your hands as they move, tilt and stretch.

Everything runs in the browser, on your device. No video leaves it.

## Run locally
```bash
npm start          # serves the folder at http://localhost:8000
npm test           # unit tests (geometry, filter, faces, options)
```
On a phone the camera requires **HTTPS**.

## Features
The bottom sheet has five tabs:

| Tab | Options |
|---|---|
| **Effect** | None, Neon, Tint, Thermal, Cartoon, Glitch, Pixel, Kaleido, Loupe ×2, Invert, Mono, Image (plus your own image) |
| **Face** | Big eyes, Big mouth, Alien, Balloon head, Tiny face, Swirl, Laser eyes, Anonymize. Applied to **everyone**, **me** (the closest face) or **others** (up to 4 faces), and only while they are inside the frame |
| **Mask** | Face masks that follow your face in 3D: Wireframe, Visor, Skull, Gold, Feline, War paint (all original designs), **Your mask** (any image painted on the downloadable template) and **Face swap** (pick a photo: its face is mapped onto yours with live lighting). Shown inside the frame only, or always on |
| **3D** | 3D accessories locked to your head pose: Crown, Halo, Shades, Horns, Party hat, Mohawk, Cat ears (original models built from primitives), or **your own `.glb` model** placed on the head, on the eyes or around the head, at 75 to 150% size |
| **Target** | Limits the colour effect to: Everything, People, Background, Skin, Hair or Clothes (person segmentation) |
| **Shape** | Rectangle, Rounded, Ellipse, Circle, Heart, Star, Diamond |
| **Color** | 9 presets plus a custom picker (drives Neon, Tint, the border and laser eyes); neon, animated rainbow, thick or no border |
| **More** | Capture timer (off / 3 s / 10 s) and the pinch gesture |

Hands-free features (both hands are busy making the frame):
- **Capture timer**: 3, 2, 1 countdown before a photo or a recording starts. Tap again or press Esc to cancel.
- **Pinch to switch**: close the frame (thumbs and indexes together) and reopen it within 0.7 s to jump to the next effect.
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
| `src/device.js` | Device profile: mobile/desktop, performance tier, detection size, model cadence |
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

## 3D accessories: how they work
- The Face Landmarker runs with `outputFacialTransformationMatrixes`. For each face it returns a 4×4 head pose that maps the canonical face model (centimetres, y up, z towards the camera, origin near the centre of the head) into camera space.
- A three.js `PerspectiveCamera` with a 63° vertical field of view (MediaPipe's virtual camera) projects that pose onto the video. In testing, the projected canonical nose tip landed within 0.5% of the detected nose landmark.
- **One shared WebGL context.** three.js renders into the same canvas after the 2D effects and face masks, so photos and recordings include the 3D. Both renderers reset GL state before drawing (`resetState()` on the three.js side, an explicit reset on ours).
- **Head occluder.** An invisible, depth-only ellipsoid sits where the head is, so the back of a crown, the arms of the glasses or a hat brim correctly disappear behind your head.
- **Frame clipping.** A stencil pass writes the frame shape (same SDF code), and accessory materials only draw where stencil = 1.
- **Pose smoothing.** Position follows faster when you move fast and smooths more when you are still. Rotation uses an adaptive slerp.
- **Your own models.** Load a `.glb` file (Draco-compressed meshes are supported). It is centred, scaled to the head and anchored on the head, on the eyes or around the head.
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

## Credits
- Face, hand and segmentation models and the canonical face mesh: [Google MediaPipe](https://github.com/google-ai-edge/mediapipe), Apache License 2.0.
- 2D signed distance functions: Inigo Quilez.
- 3D rendering: [three.js](https://threejs.org), MIT License.
