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
| **Target** | Limits the colour effect to: Everything, People, Background, Skin, Hair or Clothes (person segmentation) |
| **Shape** | Rectangle, Rounded, Ellipse, Circle, Heart, Star, Diamond |
| **Color** | 9 presets plus a custom picker (drives Neon, Tint, the border and laser eyes); neon, animated rainbow, thick or no border |

The top bar has **photo**, **video recording** (MP4 when the browser supports it, WebM otherwise, with the native share sheet on mobile), **camera switch** and **tracking points**. The last one shows the detected points and a HUD with render and tracking FPS.
You can also swipe left or right on the video to cycle effects. Settings are remembered.

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
| `src/one-euro.js` | **One Euro filter** that smooths landmarks without lag |
| `src/geometry.js` | Builds the quad between the two hands |

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
