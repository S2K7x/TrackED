# Testing

## Unit tests
`npm test` runs `node --test tests/*.test.mjs` (90 tests): music theory, melody import (MIDI parsing and track pick, skyline, YIN on synthetic tones, note segmentation, typed notes, key finding, fit to instruments, storage validation), chords/progressions, songs fit the keys, step clock, band grooves, song/rhythm/skill lessons, strum line, step grid, music guides,, gesture → note detection (pinch keys, string crossings, pad strikes, theremin), looper, music tabs/options, geometry, 3D model fit (clamping, model key, per-model store), One Euro + prediction, faces, options ↔ renderer consistency, ready-made model files present, every mask option has a painter, Kitsune/Aero exclusivity, guides (coverage, markup, real labels and limits), capture MIME, device profile, mesh data, gestures (2D + 3D), mask stabilizer, error helpers, onboarding. CI runs them on `main`, PRs and every `claude/**` push (which then auto-merges into `main`).

## Browser tests (headless Chromium with a fake camera)
Playwright and Chromium are pre-installed in the cloud container (`require('playwright')`, don't reinstall).

1. Serve the app: `python3 -m http.server 8765` (run it in the background; the session time limit stops it).
2. Make a fake webcam clip (Y4M) with ffmpeg, e.g. from a video of hands making the frame gesture. Crop out any app UI (screen recordings of reels contain Instagram buttons):
   `ffmpeg -i input.mp4 -t 10 -vf "crop=W:H:X:Y,scale=640:-2,fps=15" -pix_fmt yuv420p cam.y4m`
3. Launch Chromium with:
   `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=cam.y4m --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`
4. Drive the app through the test hook `window.__tracked`: `state`, `settings`, `set(key, value)`, `onVision(result, ts)` (inject synthetic hands / faces / masks), `renderer`, `three`, `tracker`.
   - Synthetic hands: arrays of 21 `{x, y}` with index tip at `[8]` and thumb tip at `[4]`, **pre-mirrored** (`x → 1 - x`) because `onVision` mirrors for the selfie camera.
   - To pin the frame: `setInterval(() => { s.quad = [...]; s.quadAt = performance.now(); s.missStreak = 0; s.collapsed = false; }, 20)`.

### Music mode
- Add `--autoplay-policy=no-user-gesture-required` to the Chromium flags so the AudioContext runs headless.
- Switch modes with `#modes button:has-text("Music")` (or `window.__tracked.setMode("music")`). The hook also exposes `music` and `engine`.
- Set `__tracked.tracker.onResult = () => {}` so real tracking doesn't overwrite injected hands, wrap `engine.noteOn` / `engine.drum` to count events, and feed hands with `onVision({ hands })`. Notes are triggered in `onVision`, so every injected result counts. Count `when`-scheduled notes to check the band, arp and sequencer (they run on the StepClock). `window.__fingers(cx, n)` in `test15.js`-style scripts builds a hand with n extended fingers for Chords and Arp.

- "Your melody": open Learn → `＋ Your melody`, then `page.setInputFiles('#guidePanel input[type=file]', …)` with a MIDI or WAV made in Node (a tiny MIDI writer is in `tests/melody-import.test.mjs`), or fill the textarea and click "Learn these notes". Check `__tracked.music.lesson.obj.song`. Chrome's fake mic only beeps, so a recording gives "No clear notes heard" (the path runs end to end, the pitch result needs a real voice).

### Caveats
- No GPU: rendering runs at 1 to 7 fps and models load slowly (10 s or more). Never report those FPS as real performance.
- Real tracking keeps running alongside injected data, and results can overwrite injected state.
- Without `--use-fake-ui-for-media-stream`, headless Chrome returns `NotSupportedError`. To simulate a real "Block", override `getUserMedia` in `addInitScript` to reject with `NotAllowedError`.

## Failure injection (all verified)
- Camera denied: override `getUserMedia` → error panel "Camera access was blocked".
- WebGL context loss: `gl.getExtension('WEBGL_lose_context').loseContext()` then `.restoreContext()` → a new renderer, no error panel.
- Worker crash: `tracker.worker.terminate()` + mark it busy → watchdog restart, tracking resumes.
- Bad uploads: text file → "Please pick an image…"; corrupt PNG → "Couldn't open that image…".
