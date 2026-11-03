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

## Music mode (playing music with the fingers)
| Topic | Source | What we use |
|---|---|---|
| Existing webcam hand instruments: theremins with portamento, reverb and delay; chord pads; air drums; MIDI/OSC output | [Neo Theremin](https://awesome.ecosyste.ms/projects/github.com%2Fmadebysan%2Fneo-theremin), [AirTheremin](https://github.com/EveNight-Lab/AirTheremin), [Wavr](https://github.com/MarioCruz/Wavr), [Handel](https://contra.com/p/Pe7bv77r-handel-play-music-in-the-air-with-your-webcam-my-own-product), Handmate ([RMIT](https://research-repository.rmit.edu.au/articles/conference_contribution/Handmate_An_Accessible_Browser-based_Controller_for_Web_Audio_and_Midi_using_AI_Hand-Tracking/30443186), Computer Music Journal) | Four instruments (theremin, keys, harp, drums), reverb and echo, Web MIDI output |
| Free-air pitch is hard to play; visual "frets" help | [MIT laser theremin / dynamic visual guides](https://resenv.media.mit.edu/LaserTheremin/laser.html), [Termenova (Hasan)](https://resenv.media.mit.edu/pubs/drafts/02_hasan.pdf) | Scale locking by default (pentatonic), on-screen frets, strings, pads and note labels |
| Latency: ~10 ms is the usual target for a music controller; pitch-matching time grows ~5× the added latency | [Hämäläinen et al., latency tolerance for gesture-controlled sound](https://users.aalto.fi/~hamalap5/publications/icmcarticlefinal10.pdf), [DAFx 2004 virtual theremin](https://dafx.de/paper-archive/2004/P_011.PDF) | Only the hand model runs in music mode; notes fire in `onVision` as soon as landmarks arrive; `latencyHint: "interactive"`, no look-ahead. Camera tracking (~33 ms per frame) is the floor, so drums and harp use strike/crossing detection rather than continuous control |
| Web Audio latency and click-free parameter changes | [Tone.js performance wiki](https://github.com/Tonejs/Tone.js/wiki/Performance), Web Audio spec (`latencyHint`), [Mozilla bug on setTargetAtTime](https://bugzilla.mozilla.org/show_bug.cgi?id=1228207) | `setTargetAtTime` for every envelope and glide; voice cap with oldest-first stealing |
| Plucked strings: Karplus-Strong (noise burst in a delay line with a low-pass in the loop; pitch = SR / delay length) | [J. O. Smith, CCRMA](https://ccrma.stanford.edu/~jos//pasp//Karplus_Strong_Algorithm.html), [JSyn pluck](https://softsynth.com/jsyn/examples/tj_pluck1.html) | `pluck-worklet.js`. A worklet is used because a DelayNode inside a feedback cycle can't be shorter than one 128-sample render quantum, which would cap the pitch around 345 Hz |

### Music mode, round 2: more modes, sounds and learning
| Topic | Source | What we use |
|---|---|---|
| Beginner-friendly music tools: Song Maker (grid), Rhythm, Arpeggios (chord wheel), Chords, Melody Maker | Chrome Music Lab ([overview](https://www.educatorstechnology.com/2022/08/chrome-music-lab-learn-music-through.html), [lesson ideas](https://midnightmusic.com.au/2018/09/50-lesson-ideas-for-the-chrome-music-lab/)) | Beats (step grid), Arp, Chords, Learn tab |
| Wait mode ("melody practice": the song waits for the right note), rhythm scoring against a metronome, falling-notes gamification | [Synthesia](https://apps.apple.com/us/app/synthesia/id579518445), [Songscription comparison](https://www.songscription.ai/blog/songscription-vs-synthesia), [Simply Piano commentary](https://divinations.substack.com/p/simply-pianos-silent-symphony/comments) | `SongLesson` (wait mode, stars), `RhythmLesson` (perfect, good, miss) with approaching rings |
| Webcam hand instruments with chord pads, a drum editor (16-step grid) and gesture loopers; "webcam tracking is 30 fps on a good day" | [Hand tracking instrument](https://jasperbernaers.com/hand-tracking-instrument/), [gesture.live](https://chatgate.ai/post/gesture-live), [Handel](https://contra.com/p/Pe7bv77r-handel-play-music-in-the-air-with-your-webcam-my-own-product) | Chords, Beats and DJ modes; rhythm windows of 70 / 140 ms (wide on purpose, because of ~33 ms of tracking jitter) |
| Precise timing: a JS timer looks ahead and schedules on `AudioContext.currentTime` | Chris Wilson, ["A tale of two clocks"](https://web.dev/articles/audio-scheduling), [WAAClock](https://github.com/sebpiq/WAAClock) | `scheduler.js` (25 ms timer, 120 ms look-ahead, resync after a freeze) |
| The four-chord pop progression I–V–vi–IV; chord roles; backing tracks for improvising | [Pause Play Repeat](https://www.pauseplayrepeat.com/blog/the-i-v-vi-iv-progression-the-four-chords-of-pop), [Musical U](https://www.musical-u.com/modules/chord-progressions/progression-practice-i-iv-v-vi/), [Omni chord generator](https://www.omnicalculator.com/other/chord-progression) | `PROGRESSIONS`, `band.js` (bass follows the chord root, stabs play the triad) |
| FM synthesis for electric piano / brass in the browser | [KAIST Web Audio FM lecture](https://mac.kaist.ac.kr/~juhan/ctp431/2015/web_audio4.html) (after Chris Lowis); [WebAudioFont](https://github.com/surikov/webaudiofont) (sample-based alternative, not used) | `TIMBRES` in `audio.js`: FM e-piano and marimba (decaying modulation index), additive organ, formant choir, detuned-saw strings, filter-swell brass, chip, bass |
| Public-domain melodies only | Traditional tunes and 19th-century compositions (Beethoven's Ode to Joy, 1824) | `songs.js` (notes only, no lyrics) |

### Music mode, round 3: "Your melody" (importing a tune to learn)
| Topic | Source | What we use |
|---|---|---|
| Monophonic pitch detection: YIN (cumulative mean normalized difference, absolute threshold, parabolic interpolation) vs McLeod (NSDF); YIN is the usual accuracy/speed balance but can jump octaves | [de Cheveigné & Kawahara 2002 (YIN)](http://audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf), [pitchfinder](https://cdn.jsdelivr.net/npm/pitchfinder@2.3.4/README.md), [pitch-estimate docs](https://docs.rs/pitch-estimate) | `yin()` in pure JS (70–1100 Hz, threshold 0.12, clarity gate 0.6); a 5-frame median filter removes octave blips |
| Humming transcription = segmentation (onsets, durations) + pitch per segment; singers can't hold a pitch, so drift inside a note must not split it | [Humming segmentation patent US8193436](https://patents.google.com/patent/US8193436), [Essentia pitch + note segmentation demo](https://github.com/MTG/essentia/blob/master/src/examples/standard_pitchdemo.cpp), [Rochester student report](https://hajim.rochester.edu/ece/sites/zduan/teaching/ece477/projects/2015/Qiaozhan_Gao_report_ReportFinal.pdf) | `segmentNotes()`: silence or a pitch change held for 3 frames (36 ms) starts a note; notes under 80 ms dropped; note pitch = median |
| Audio-to-MIDI for polyphonic audio | [Spotify Basic Pitch](https://engineering.atspotify.com/meet-basic-pitch/), [basic-pitch-ts](https://github.com/spotify/basic-pitch-ts) ("works best on one instrument at a time") | Not used yet (TensorFlow.js dependency, still no melody isolation from a full mix); possible lazy-loaded option later |
| Picking the melody in a multitrack MIDI file: skyline (highest note), top channel (highest mean pitch), track names, classifiers | [Uitdenbogerd & Zobel via Clarinet (arXiv 2210.12648)](https://ar5iv.labs.arxiv.org/html/2210.12648), [Rizo et al., ISMIR 2006](https://archives.ismir.net/ismir2006/paper/000123.pdf), [Velusamy et al.](https://eprints.iisc.ac.in/26572) | `melodyScore()` (name hints, no drums on channel 10, mean pitch, monophony) then `skyline()` |
| Key finding: Krumhansl–Kessler probe-tone profiles correlated with the pitch-class histogram (24 rotations); can over-weight repeated notes | [Temperley, "What's key for key?"](https://music.informatics.indiana.edu/courses/I546/pdf/temperley.pdf), [arXiv 2505.17259](https://arxiv.org/html/2505.17259v1), [Essentia Key](https://essentia.upf.edu/reference/std_Key.html) | `detectKey()`: fewest off-scale beats first, K-S (duration-weighted, +2 on the last note, slight major lean) breaks ties |
