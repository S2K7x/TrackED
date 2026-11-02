import { Renderer, EFFECTS } from "./renderer.js";
import { HandTracker } from "./tracker.js";
import { PointsFilter } from "./one-euro.js";
import { quadFromHands, quadArea, mirrorLandmarks } from "./geometry.js";

const $ = (s) => document.querySelector(s);
const video = $("#cam");
const canvas = $("#out");
const debugCanvas = $("#debug-layer");
const statusEl = $("#status");

const state = {
  effect: "neon",
  facing: "user",
  debug: false,
  hands: [],          // latest landmarks (already mirrored for display)
  quad: null,         // smoothed frame corners
  alpha: 0,           // frame fade 0..1
  missStreak: 99,     // consecutive detections without two hands
};

const FADE_IN = 8;    // alpha units per second
const FADE_OUT = 5;
const MAX_MISSES = 3; // keep the frame through a few missed detections (motion blur, occlusion)

const quadFilter = new PointsFilter(4, { minCutoff: 1.5, beta: 8, dCutoff: 1 });
const stats = { renderFrames: 0, detectFrames: 0, fps: 0, dps: 0, since: performance.now() };

let renderer, tracker;

// ---------------- UI ----------------
for (const b of document.querySelectorAll("[data-fx]")) {
  b.addEventListener("click", () => setEffect(b.dataset.fx));
}
function setEffect(fx) {
  if (!EFFECTS.includes(fx)) return;
  state.effect = fx;
  for (const x of document.querySelectorAll("[data-fx]")) x.classList.toggle("on", x.dataset.fx === fx);
}
$("#debug").addEventListener("click", (e) => {
  state.debug = !state.debug;
  e.currentTarget.classList.toggle("on", state.debug);
  debugCanvas.hidden = !state.debug;
});
$("#flip").addEventListener("click", async () => {
  state.facing = state.facing === "user" ? "environment" : "user";
  await startCamera();
});
$("#file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f || !renderer) return;
  // createImageBitmap decodes off the main thread and applies EXIF orientation
  const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
  renderer.setOverlay(bmp);
  bmp.close();
  setEffect("image");
});
// swipe left/right to change effect
let touchX = null;
canvas.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
canvas.addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) < 50) return;
  const i = EFFECTS.indexOf(state.effect);
  setEffect(EFFECTS[(i + (dx < 0 ? 1 : EFFECTS.length - 1)) % EFFECTS.length]);
}, { passive: true });

$("#go").addEventListener("click", start, { once: true });

async function start() {
  $("#start").remove();
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    statusEl.textContent = err.message;
    return;
  }
  tracker = new HandTracker();
  tracker.onResult = onHands;
  statusEl.textContent = "Chargement du modèle…";
  try {
    // camera and model load in parallel
    const [mode] = await Promise.all([tracker.init(), startCamera()]);
    state.trackerMode = mode;
  } catch (err) {
    statusEl.textContent = "Erreur : " + (err?.message || err);
    console.error(err);
    return;
  }
  statusEl.textContent = "Montre tes deux mains en forme de L";
  scheduleFrame();
}

async function startCamera() {
  video.srcObject?.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: state.facing,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  });
  video.srcObject = stream;
  await video.play();
  quadFilter.reset();
  state.quad = null;
}

// ---------------- Frame loop ----------------
// requestVideoFrameCallback fires exactly once per new camera frame, so we never
// render or detect the same frame twice. Falls back to rAF + currentTime check.
const hasRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
let lastVideoTime = -1;

function scheduleFrame() {
  if (hasRVFC) video.requestVideoFrameCallback(onFrame);
  else requestAnimationFrame(onFrame);
}

function onFrame(now) {
  scheduleFrame();
  if (!hasRVFC) {
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
  }
  const t = performance.now();
  tracker.submit(video, t);
  update(t / 1000);
  renderer.draw(video, {
    quad: state.quad,
    alpha: state.alpha,
    effect: state.effect,
    mirror: state.facing === "user",
    time: t / 1000,
  });
  if (state.debug) drawDebug();
  countFps(t);
}

function onHands(hands, timestampMs) {
  stats.detectFrames++;
  const mirror = state.facing === "user";
  state.hands = mirror ? hands.map(mirrorLandmarks) : hands;
  const aspect = video.videoWidth / video.videoHeight || 1;
  if (state.hands.length === 2) {
    const q = quadFromHands(state.hands[0], state.hands[1]);
    state.quad = quadFilter.filter(q, timestampMs / 1000);
    state.collapsed = quadArea(q, aspect) < 0.0004; // fingers pinched together → close the frame
    state.missStreak = 0;
  } else {
    state.missStreak++;
  }
  const n = state.hands.length;
  const status = n === 2 ? "" : n === 1 ? "Montre ta deuxième main" : "Montre tes deux mains en forme de L";
  if (statusEl.textContent !== status) statusEl.textContent = status;
}

let lastUpdate = 0;
function update(t) {
  const dt = Math.min(0.1, t - (lastUpdate || t));
  lastUpdate = t;
  const visible = state.quad && state.missStreak <= MAX_MISSES && !state.collapsed;
  state.alpha = visible ? Math.min(1, state.alpha + FADE_IN * dt) : Math.max(0, state.alpha - FADE_OUT * dt);
  if (state.alpha === 0 && !visible && state.quad) {
    state.quad = null;
    quadFilter.reset();
  }
}

// ---------------- Debug overlay ----------------
const dctx = debugCanvas.getContext("2d");
function drawDebug() {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio || 1;
  if (debugCanvas.width !== w * dpr) { debugCanvas.width = w * dpr; debugCanvas.height = h * dpr; }
  dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dctx.clearRect(0, 0, w, h);
  // replicate object-fit: contain
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.min(w / vw, h / vh), ox = (w - vw * s) / 2, oy = (h - vh * s) / 2;
  dctx.fillStyle = "#0f0";
  for (const lm of state.hands) {
    for (const p of lm) dctx.fillRect(ox + p.x * vw * s - 2, oy + p.y * vh * s - 2, 4, 4);
  }
  dctx.font = "12px ui-monospace, monospace";
  dctx.fillStyle = "rgba(0,0,0,.6)";
  dctx.fillRect(8, 40, 230, 20);
  dctx.fillStyle = "#0f0";
  dctx.fillText(`rendu ${stats.fps} fps · détection ${stats.dps} fps · ${state.trackerMode}`, 14, 54);
}

function countFps(t) {
  stats.renderFrames++;
  if (t - stats.since >= 1000) {
    const k = 1000 / (t - stats.since);
    stats.fps = Math.round(stats.renderFrames * k);
    stats.dps = Math.round(stats.detectFrames * k);
    stats.renderFrames = stats.detectFrames = 0;
    stats.since = t;
  }
}

// Pause camera when the page is hidden (saves battery), resume when visible.
document.addEventListener("visibilitychange", () => {
  if (!video.srcObject) return;
  if (document.hidden) video.pause();
  else video.play().catch(() => {});
});

// test hook (used by automated browser tests only)
window.__tracked = { state, setEffect, onHands };
