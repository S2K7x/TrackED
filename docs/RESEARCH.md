# Research log

Everything researched while building TrackED, with what we took from each source and where it lives in the code.

## Hand / face / body tracking (ML)
| Topic | Source | What we use | Code |
|---|---|---|---|
| Hand tracking pipeline (palm detector → 21-landmark model, handedness + presence score, 2.5D landmarks) | F. Zhang et al., *MediaPipe Hands*, 2020, [arXiv:2006.10214](https://arxiv.org/abs/2006.10214) | Handedness labels + confidence (drop < 0.6; two same-handed confident hands never build a frame); world landmarks for 3D sign classification | `main.js` (onVision), `vision.js`, `gestures.js` |
| Face mesh (468 points + irises), attention on eyes/lips | I. Grishchenko et al., *Attention Mesh*, 2020, [arXiv:2006.10962](https://arxiv.org/abs/2006.10962) | Face Landmarker for face warps, masks, face swap | `vision.js`, `faces.js` |
| Hand Landmarker web API, VIDEO mode (tracking skips palm detection), worker recommendation | [MediaPipe Hand Landmarker web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js) | VIDEO mode, worker, GPU delegate + CPU fallback | `vision.js`, `tracker*.js` |
| Gesture Recognizer (8 canned gestures: thumbs up, victory, open palm…) | [MediaPipe Gesture Recognizer web guide](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js) | Same gesture set, but classified from landmarks we already have (no second model) | `gestures.js` |
| Timestamps must be monotonically increasing in VIDEO mode | [MediaPipe docs](https://developers.google.cn/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarker) | Strictly increasing timestamps | `tracker.js` (`#nextTimestamp`) |
| Image Segmenter, `selfie_multiclass_256x256` (background, hair, body skin, face skin, clothes, others) | [MediaPipe Image Segmenter](https://developers.google.cn/mediapipe/solutions/vision/image_segmenter) | Target filter (people/background/skin/hair/clothes) | `vision.js`, `faces.js` (TARGETS), shader `targetMask` |
| Head pose matrix (`outputFacialTransformationMatrixes`), canonical face in cm | [FaceLandmarker options](https://ai.google.dev/edge/api/mediapipe/js/tasks-vision.facelandmarkeroptions) | three.js camera with 63° vertical FOV; projection verified within 0.5% of the detected nose landmark | `three-layer.js` |
| `ModuleFactory not set` with several tasks in a module worker | MediaPipe loader source (`vision_bundle.mjs`) | `self.import` hook that reuses the WASM factory | `vision.js` (`installModuleFactoryCache`) |

## Filtering, latency, temporal stability
| Topic | Source | What we use |
|---|---|---|
| One Euro filter: speed-adaptive low-pass, tuning procedure (beta = 0, lower min cutoff until jitter is OK, raise beta until lag is OK) | G. Casiez, N. Roussel, D. Vogel, CHI 2012, [1€ filter page](https://cristal.univ-lille.fr/~casiez/1euro) | `one-euro.js`. Derivative taken on the **raw** signal, as in the paper. Tuned with `tools/tune-filter.mjs`: `minCutoff 2, beta 12` (≈10% less lag than 1.5/8, +0.05 to 0.13 px jitter) |
| Jitter vs lag trade-off; prediction complements filtering | [N-euro, Shao et al. 2023](https://cave.cs.columbia.edu/Statics/publications/pdfs/Shao_Mob23.pdf); Kalman vs grey-system head-tracking studies | Latency EMA + velocity extrapolation (capped at 80 ms) | 
| Temporal consistency for mobile video segmentation | [Google: Mobile real-time video segmentation](https://research.google/blog/mobile-real-time-video-segmentation/); classical change-detection stabilisation (VLSI 2008) | 3-frame temporal vote on the category mask (`temporal.js`) |
| Edge refinement of low-res masks | [Google Meet background features](https://research.google/blog/background-features-in-google-meet-powered-by-web-ml/), [Slack clips](https://slack.engineering/building-background-effects-for-clips/) | 3×3 joint bilateral (colour-guided) refinement in the shader; skipped on low-tier devices |

## Rendering
| Topic | Source | What we use |
|---|---|---|
| Inverse bilinear interpolation (pixel → (u,v) in a quad) | Inigo Quilez | Frame mapping, perspective-warped overlay |
| 2D SDFs (heart, star…) + `fwidth` anti-aliasing | Inigo Quilez's 2D distance functions; [jvns.ca SDF intro](https://jvns.ca/blog/2020/03/15/writing-shaders-with-signed-distance-functions/) | Frame shapes |
| Face mask from canonical UVs. OBJ `v` and `vt` orders differ, so recover each landmark's UV from the `f` records; watch V flip and mirroring | [Codrops: real-time 3D face mask with MediaPipe](https://tympanus.net/codrops/2026/09/06/building-a-real-time-3d-face-mask-with-mediapipe-threlte-and-three-js/), [canonical_face_model.obj](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj), [spite/FaceMeshFaceGeometry](https://spite.github.io/FaceMeshFaceGeometry/) | `tools/gen-face-mesh.mjs`, `masks.js`, mask pass |
| Face swap: triangulation warp + seamless blending (Poisson) | Face-swap pipelines (WPI, Educative, academic write-ups) | Photo landmarks as UVs + local colour transfer (live low-pass ÷ photo low-pass), feathered outline, open eyes/mouth |
| Head occluder for 3D accessories (depth-only head) | Common AR practice (drei Facemesh, three.js forum) | `three-layer.js` (`makeOccluder`) |
| WebGL context loss: `preventDefault`, pause, rebuild all resources on restore | [Khronos: Handling context lost](https://wikis.khronos.org/webgl/HandlingContextLost) | `main.js` (`watchContextLoss`) |

## Performance and platform
| Topic | Source | What we use |
|---|---|---|
| Worker back-pressure (one frame in flight, drop instead of queue), `requestVideoFrameCallback` | [Fishjam: real-time gesture recognition](https://fishjam.swmansion.com/blog/real-time-gesture-recognition-in-videoconferencing-4711855a1a53) | `tracker.js`, frame loop |
| Service worker caching of models / WASM, offline | [MDN offline service workers](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Offline_Service_workers), [MediaPipe demo offline PR](https://github.com/googlesamples/mediapipe/pull/215) | `sw.js` (cache-first for versioned CDN assets, network-first for app files) |
| getUserMedia errors (standard + legacy Chrome names), relax constraints | [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [addpipe: common getUserMedia errors](https://blog.addpipe.com/common-getusermedia-errors/) | `errors.js` (`describeCameraError`, `constraintLadder`) |

## UX / onboarding
| Topic | Source | What we use |
|---|---|---|
| Permission priming (explain before the native prompt) | [uxcel](https://uxcel.com/lessons/ask-permission-best-practices-607), [UX Planet](https://uxplanet.org/why-permission-priming-is-good-ux-19c675754dbb) | One sentence under "Start camera" |
| Hand-tracking onboarding: learn by doing, neutral hand animation, prompt stays until success, replayable | [Meta hands onboarding](https://developers.meta.com/vr/design/hands-onboarding-best-practices/), [Ultraleap tutorials & hints](https://docs.ultraleap.com/xr-guidelines/Getting%20started/tutorials_hints_tip.html) | `onboarding.js` + coach card |
| Visual design reference (light, frosted glass, gradient tiles, thin line art, lime accent) | Owner's reference images ("Neka" health dashboard) | `styles.css`, `art.js` |

## Masks and characters (owner's question)
- Fabric masks that hug the face are best as a **2D texture on the face mesh** ("Your mask" + downloadable UV template): they follow expressions and get live lighting.
- Rigid helmets are best as **3D `.glb` from Blender**: rigid shape, covers the whole head, metal reflections. Blender tips: centimetres, face width ≈ 15.5 cm, Y up, +Z towards the camera; < 50k triangles, < 5 MB, Draco, PBR, apply transforms, a single `.glb`.
- Best of both: a 3D helmet plus a 2D face texture.
- **Policy:** copyrighted characters (e.g. Spider-Man, Iron Man) are never recreated by Claude, whether as built-ins, Blender models or adapted images. Offer original designs instead.
