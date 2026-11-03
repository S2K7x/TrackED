#!/usr/bin/env node
// Light headless smoke test of the superpower mode: every power is triggered
// with injected hands / body mask / face, then checked for WebGL and console
// errors, with a screenshot each.
//
// Kept deliberately light so a laptop stays cool:
//  - a tiny fake camera (320×180, 15 fps, 2 s loop)
//  - real tracking switched OFF as soon as the app is up (`state.noTracking`):
//    the MediaPipe models don't run on every frame, only the injected data is used
//  - a small window, one browser, injection at 15 Hz, a single pass
//
// Usage:
//   ffmpeg -f lavfi -i "gradients=s=320x180:c0=0x2a3038:c1=0x7a6a5a:speed=0.02:r=15" -t 2 -pix_fmt yuv420p /tmp/cam.y4m
//   node tools/powers-smoke.cjs --cam /tmp/cam.y4m --out /tmp/shots [--only wave,frost]
// Env: PLAYWRIGHT (module path, default "playwright"), CHROMIUM (browser executable, optional)

const http = require("http");
const fs = require("fs");
const path = require("path");

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(args.out || "powers-shots");
const CAM = args.cam && path.resolve(args.cam);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
if (!CAM || !fs.existsSync(CAM)) { console.error("Pass --cam <file.y4m> (see the usage at the top of this file)"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".glb": "model/gltf-binary", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

// hands, masks and faces built in the page (display space, pre-mirrored: onVision mirrors for the selfie camera)
function pageHelpers() {
  const T = window.__tracked;
  T.state.noTracking = true;
  T.tracker.onResult = () => {};
  window.__hand = (cx, cy, { s = 0.1, fingers = 4, thumb = true, pinch = false, point = null } = {}) => {
    const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
    lm[0] = { x: cx, y: cy + s };
    const cols = [-0.3, -0.1, 0.1, 0.3];
    [5, 9, 13, 17].forEach((b, i) => {
      const x = cx + cols[i] * s, up = i < fingers;
      lm[b] = { x, y: cy };
      if (up) { lm[b + 1] = { x, y: cy - 0.35 * s }; lm[b + 2] = { x, y: cy - 0.6 * s }; lm[b + 3] = { x, y: cy - 0.85 * s }; }
      else { lm[b + 1] = { x, y: cy - 0.3 * s }; lm[b + 2] = { x: x + 0.01 * s, y: cy - 0.1 * s }; lm[b + 3] = { x, y: cy + 0.1 * s }; }
    });
    if (point) for (let i = 6; i <= 8; i++) lm[i] = { x: lm[5].x + point.x * (i - 5) * 0.3 * s, y: lm[5].y + point.y * (i - 5) * 0.3 * s };
    lm[1] = { x: cx - 0.35 * s, y: cy + 0.7 * s }; lm[2] = { x: cx - 0.55 * s, y: cy + 0.45 * s };
    if (thumb) { lm[3] = { x: cx - 0.75 * s, y: cy + 0.2 * s }; lm[4] = { x: cx - 0.95 * s, y: cy - 0.05 * s }; }
    else { lm[3] = { x: cx - 0.4 * s, y: cy + 0.3 * s }; lm[4] = { x: cx - 0.2 * s, y: cy + 0.2 * s }; }
    if (pinch) lm[4] = { ...lm[8] };
    return lm.map((p) => ({ x: 1 - p.x, y: p.y }));
  };
  window.__mask = (cx, cy, rx, ry) => {
    const W = 128, H = 128, d = new Uint8Array(W * H), mx = 1 - cx;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = ((x + 0.5) / W - mx) / rx, v = ((y + 0.5) / H - cy) / ry;
      d[y * W + x] = u * u + v * v < 1 ? 255 : 0;
    }
    return { data: d, width: W, height: H };
  };
  window.__send = (hands, extra = {}) => T.onVision({ hands, handInfo: hands.map((_, i) => ({ label: i ? "Right" : "Left", score: 0.95 })), ...extra }, performance.now());
  // n frames at 15 Hz; f(i) returns [hands, extra]
  window.__play = async (n, f) => { for (let i = 0; i < n; i++) { const [h, e] = f(i); __send(h, e); await new Promise((r) => setTimeout(r, 66)); } };
}

// scenario per power: runs in the page, returns a short state summary
const SCENARIOS = {
  wave: async () => {
    await __play(26, () => [[__hand(0.47, 0.55), __hand(0.53, 0.55)]]);
    const charge = __tracked.powers.ability.charge.charge;
    await __play(5, (i) => [[__hand(0.47 + (i + 1) * 0.06, 0.55), __hand(0.53 + (i + 1) * 0.06, 0.55)]]);
    await __play(3, () => [[__hand(0.2, 0.55), __hand(0.95, 0.55)]]);
    return { charge: +charge.toFixed(2), beams: __tracked.powers.ability.beams.length };
  },
  lightning: async () => {
    await __play(8, () => [[__hand(0.35, 0.5), __hand(0.6, 0.5)]]);
    await __play(2, () => [[__hand(0.35, 0.5, { pinch: true }), __hand(0.6, 0.5)]]);
    return { strikes: __tracked.powers.ability.strikes.length, scorch: __tracked.powers.scorches.length };
  },
  fire: async () => {
    await __play(12, () => [[__hand(0.3, 0.6)]]);
    await __play(3, (i) => [[__hand(0.3 + i * 0.12, 0.6)]]);
    return { fireballs: __tracked.powers.ability.balls.length, particles: __tracked.powers.particles.n };
  },
  frost: async () => {
    await __play(30, () => [[__hand(0.3, 0.5), __hand(0.7, 0.5)]]);
    return { patches: __tracked.powers.ability.patches.length, creep: +__tracked.powers.world.frost.toFixed(2) };
  },
  force: async () => {
    await __play(8, () => [[__hand(0.3, 0.5, { pinch: true }), __hand(0.7, 0.5)]]);
    return { wells: __tracked.powers.world.wells.length };
  },
  shield: async () => {
    await __play(10, () => [[__hand(0.45, 0.5)]]);
    return { shield: __tracked.powers.B.count > 0 };
  },
  warp: async () => {
    await __play(10, (i) => [[__hand(0.4 + i * 0.012, 0.5, { pinch: true })]]);
    return { drags: __tracked.powers.world.drags.length };
  },
  invisible: async () => {
    __tracked.set("activation", "always");
    await __play(6, () => [[], { person: __mask(0.5, 0.5, 0.001, 0.001) }]);
    await __play(20, () => [[], { person: __mask(0.5, 0.6, 0.16, 0.42) }]);
    const out = { invis: +__tracked.powers.ability.st.level.toFixed(2) };
    __tracked.set("activation", "gesture");
    return out;
  },
  freeze: async () => {
    await __play(4, () => [[], { person: __mask(0.5, 0.6, 0.16, 0.42) }]);
    await __play(6, (i) => { const x = [0.1, 0.25, 0.4, 0.47, 0.47, 0.47][i]; return [[__hand(x, 0.5), __hand(1 - x, 0.5)], { person: __mask(0.5, 0.6, 0.16, 0.42) }]; });
    await __play(6, () => [[], { person: __mask(0.5, 0.6, 0.16, 0.42) }]);
    return { frozen: __tracked.powers.ability.st.on };
  },
  speed: async () => {
    await __play(20, (i) => [[__hand(0.2 + i * 0.03, 0.4)], { person: __mask(0.25 + i * 0.02, 0.6, 0.12, 0.4) }]);
    return {};
  },
  clones: async () => {
    __tracked.set("activation", "always");
    await __play(20, () => [[], { person: __mask(0.5, 0.6, 0.1, 0.4) }]);
    const out = { clones: __tracked.powers.ability.st.on };
    __tracked.set("activation", "gesture");
    return out;
  },
  teleport: async () => {
    await __play(6, () => [[], { person: __mask(0.5, 0.5, 0.001, 0.001) }]);
    await __play(14, () => [[__hand(0.62, 0.5, { fingers: 1, thumb: false, point: { x: 1, y: 0 } })], { person: __mask(0.5, 0.6, 0.12, 0.4) }]);
    await __play(6, () => [[], { person: __mask(0.5, 0.6, 0.12, 0.4) }]);
    return { offset: +__tracked.powers.ability.offset.toFixed(2) };
  },
  size: async () => {
    await __play(6, () => [[], { person: __mask(0.5, 0.5, 0.001, 0.001) }]);
    await __play(14, (i) => [[__hand(0.42 - i * 0.012, 0.4, { pinch: true }), __hand(0.58 + i * 0.012, 0.4, { pinch: true })], { person: __mask(0.5, 0.6, 0.12, 0.4) }]);
    return { scale: +__tracked.powers.ability.zoom.scale.toFixed(2) };
  },
  eyes: async () => {
    const face = { eyeL: { x: 0.45, y: 0.4 }, eyeR: { x: 0.55, y: 0.4 }, mouth: { x: 0.5, y: 0.52 }, nose: { x: 0.44, y: 0.46 }, r: 0.1, open: 0.4 };
    await __play(16, () => [[], { faces: [face] }]);
    return { laser: __tracked.powers.ability.st.on, scorch: __tracked.powers.scorches.length };
  },
  portal: async () => {
    await __play(4, () => [[], { person: __mask(0.35, 0.6, 0.12, 0.4) }]);
    await __play(34, (i) => { const a = (i / 30) * Math.PI * 2; return [[__hand(0.7 + (0.12 * Math.cos(a)) / 1.78, 0.45 + 0.12 * Math.sin(a) + 0.085, { fingers: 1, thumb: false })], { person: __mask(0.35, 0.6, 0.12, 0.4) }]; });
    await __play(10, () => [[], { person: __mask(0.35, 0.6, 0.12, 0.4) }]);
    return { portals: __tracked.powers.ability.portals.length };
  },
  aura: async () => {
    await __play(40, () => [[__hand(0.35, 0.6, { fingers: 0, thumb: false }), __hand(0.65, 0.6, { fingers: 0, thumb: false })], { person: __mask(0.5, 0.6, 0.16, 0.42) }]);
    return { aura: +__tracked.powers.ability.st.level.toFixed(2) };
  },
};

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${CAM}`, "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/XNNPACK/.test(m.text())) errors.push(m.text()); if (/GL_INVALID|feedback loop/i.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem("tracked.tutorialDone", "1"); } catch { /* */ } });
  await page.goto(url);
  await page.click("#go");
  await page.waitForFunction(() => window.__tracked?.state.trackerMode, null, { timeout: 90000 });
  await page.evaluate(pageHelpers);
  await page.evaluate(() => window.__tracked.setMode("powers"));
  await page.waitForFunction(() => window.__tracked.powers, null, { timeout: 20000 });
  let failed = 0;
  for (const [id, run] of Object.entries(SCENARIOS)) {
    if (ONLY && !ONLY.has(id)) continue;
    await page.evaluate((id) => { window.__tracked.set("power", id); window.__tracked.powers.learnBackground(); }, id);
    const summary = await page.evaluate(`(${run.toString()})()`);
    const gl = await page.evaluate(() => window.__tracked.renderer.gl.getError());
    await page.locator("#stage").screenshot({ path: path.join(OUT, `${id}.png`) });
    if (gl) failed++;
    console.log(`${id.padEnd(10)} gl=${gl} ${JSON.stringify(summary)}`);
  }
  await page.evaluate(() => window.__tracked.setMode("effects"));
  console.log(errors.length ? `errors:\n${[...new Set(errors)].join("\n")}` : "errors: none");
  await browser.close();
  server.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
