# Testing

## Unit tests
`npm test` runs `node --test tests/*.test.mjs` (50 tests): geometry, 3D model fit (clamping, model key, per-model store), One Euro + prediction, faces, options ↔ renderer consistency, capture MIME, device profile, mesh data, gestures (2D + 3D), mask stabilizer, error helpers, onboarding. CI runs them on `main`, PRs and every `claude/**` push (which then auto-merges into `main`).

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

### Caveats
- No GPU: rendering runs at 1 to 7 fps and models load slowly (10 s or more). Never report those FPS as real performance.
- Real tracking keeps running alongside injected data, and results can overwrite injected state.
- Without `--use-fake-ui-for-media-stream`, headless Chrome returns `NotSupportedError`. To simulate a real "Block", override `getUserMedia` in `addInitScript` to reject with `NotAllowedError`.

## Failure injection (all verified)
- Camera denied: override `getUserMedia` → error panel "Camera access was blocked".
- WebGL context loss: `gl.getExtension('WEBGL_lose_context').loseContext()` then `.restoreContext()` → a new renderer, no error panel.
- Worker crash: `tracker.worker.terminate()` + mark it busy → watchdog restart, tracking resumes.
- Bad uploads: text file → "Please pick an image…"; corrupt PNG → "Couldn't open that image…".
