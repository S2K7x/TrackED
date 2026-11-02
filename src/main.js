import { Renderer } from "./renderer.js";
import { HandTracker } from "./tracker.js";
import { PointsFilter } from "./one-euro.js";
import { quadFromHands, quadArea, mirrorLandmarks } from "./geometry.js";
import { mirrorFace, selectFaces, TARGETS } from "./faces.js";
import { OPTIONS, TABS, DEFAULTS, hexToRgb } from "./options.js";
import { Capture } from "./capture.js";

const $ = (s) => document.querySelector(s);
const video = $("#cam");
const canvas = $("#out");
const debugCanvas = $("#debug-layer");
const statusEl = $("#status");

// ---------------- State ----------------
const settings = loadSettings();
const state = {
  facing: "user",
  debug: false,
  hands: [],          // latest hand landmarks (display space)
  faces: [],          // latest face anchors (display space)
  facesAt: 0,
  quad: null,         // smoothed frame corners
  alpha: 0,           // frame fade 0..1
  missStreak: 99,     // consecutive detections without two hands
  collapsed: false,
  frameNo: 0,
};

const FADE_IN = 8;        // alpha units per second
const FADE_OUT = 5;
const MAX_MISSES = 3;     // keep the frame through a few missed detections (motion blur, occlusion)
const FACE_TTL = 0.6;     // seconds before stale face data is dropped

const quadFilter = new PointsFilter(4, { minCutoff: 1.5, beta: 8, dCutoff: 1 });
const stats = { renderFrames: 0, detectFrames: 0, fps: 0, dps: 0, since: performance.now() };

let renderer, tracker, capture;

// ---------------- Settings (per-viewer convenience; works without storage) ----------------
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("tracked.settings") || "{}");
    const s = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (k === "color" ? /^#[0-9a-f]{6}$/i.test(saved[k]) : OPTIONS[k]?.some((o) => o.value === saved[k])) s[k] = saved[k];
    }
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  try { localStorage.setItem("tracked.settings", JSON.stringify(settings)); } catch { /* private mode */ }
}

// ---------------- UI ----------------
let activeTab = "effect";
const tabsEl = $("#tabs");
const chipsEl = $("#chips");

function renderTabs() {
  tabsEl.replaceChildren(...TABS.map((t) => {
    const b = document.createElement("button");
    b.textContent = t.label;
    b.className = t.id === activeTab ? "on" : "";
    b.addEventListener("click", () => { activeTab = t.id; renderTabs(); renderChips(); });
    return b;
  }));
}

function renderChips() {
  const tab = TABS.find((t) => t.id === activeTab);
  const nodes = [];
  tab.groups.forEach((group, gi) => {
    if (gi > 0) nodes.push(Object.assign(document.createElement("span"), { className: "sep" }));
    if (group === "color") {
      for (const c of OPTIONS.color) {
        const b = document.createElement("button");
        b.className = "swatch" + (settings.color.toLowerCase() === c.value ? " on" : "");
        b.style.setProperty("--c", c.value);
        b.title = c.label;
        b.setAttribute("aria-label", c.label);
        b.addEventListener("click", () => set("color", c.value));
        nodes.push(b);
      }
      const pick = document.createElement("label");
      pick.className = "chip";
      pick.innerHTML = `🎨 Autre<input type="color" value="${settings.color}">`;
      pick.querySelector("input").addEventListener("input", (e) => set("color", e.target.value, false));
      nodes.push(pick);
      return;
    }
    for (const o of OPTIONS[group]) {
      const b = document.createElement("button");
      b.className = "chip" + (settings[group] === o.value ? " on" : "");
      b.textContent = o.label;
      b.addEventListener("click", () => set(group, o.value));
      nodes.push(b);
    }
    if (group === "effect") {
      const up = document.createElement("label");
      up.className = "chip";
      up.innerHTML = `📷 Image perso<input type="file" accept="image/*">`;
      up.querySelector("input").addEventListener("change", onImagePicked);
      nodes.push(up);
    }
  });
  chipsEl.replaceChildren(...nodes);
}

function set(key, value, rerender = true) {
  settings[key] = value;
  saveSettings();
  if (rerender) renderChips();
}

async function onImagePicked(e) {
  const f = e.target.files[0];
  if (!f || !renderer) return;
  // createImageBitmap decodes off the main thread and applies EXIF orientation
  const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
  renderer.setOverlay(bmp);
  bmp.close();
  set("effect", "image");
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
$("#photo").addEventListener("click", () => capture?.photo());
$("#rec").addEventListener("click", (e) => {
  if (!capture) return;
  const on = capture.toggleRecording();
  e.currentTarget.classList.toggle("rec", on);
  e.currentTarget.textContent = on ? "⏹ Stop" : "⏺ Vidéo";
});

// swipe left/right on the video to cycle through effects
let touchX = null;
canvas.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
canvas.addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) < 50) return;
  const list = OPTIONS.effect.map((o) => o.value);
  const i = list.indexOf(settings.effect);
  set("effect", list[(i + (dx < 0 ? 1 : list.length - 1)) % list.length]);
}, { passive: true });

renderTabs();
renderChips();
$("#go").addEventListener("click", start, { once: true });

// ---------------- Startup ----------------
async function start() {
  $("#start").remove();
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    statusEl.textContent = err.message;
    return;
  }
  capture = new Capture(canvas, (msg) => flash(msg));
  tracker = new HandTracker();
  tracker.onResult = onVision;
  statusEl.textContent = "Chargement du modèle…";
  try {
    const [mode] = await Promise.all([tracker.init(), startCamera()]); // in parallel
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
    video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  await video.play();
  quadFilter.reset();
  state.quad = null;
  state.faces = [];
}

let flashTimer;
function flash(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.hidden = true; }, 2200);
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

function onFrame() {
  scheduleFrame();
  if (!hasRVFC) {
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
  }
  const t = performance.now();
  tracker.submit(video, t, extrasWanted());
  update(t / 1000);
  renderer.draw(video, frameState(t / 1000));
  capture.afterDraw(); // photo snapshot must happen right after drawing (drawing buffer isn't preserved)
  if (state.debug) drawDebug();
  countFps(t);
}

/**
 * Face mesh and segmentation are expensive, so they only run while a frame is
 * on screen and an option needs them. When both are needed they alternate
 * frames, so each runs at ~half the camera rate.
 */
function extrasWanted() {
  if (!state.quad) return {};
  const face = settings.face !== "none";
  const seg = TARGETS[settings.target] != null;
  state.frameNo++;
  if (face && seg) return state.frameNo % 2 ? { face: true } : { seg: true };
  return { face, seg };
}

function frameState(time) {
  const faces = time - state.facesAt < FACE_TTL ? state.faces : [];
  const on = selectFaces(faces, settings.who);
  return {
    quad: state.quad,
    alpha: state.alpha,
    effect: settings.effect,
    shape: settings.shape,
    border: settings.border,
    color: hexToRgb(settings.color),
    mirror: state.facing === "user",
    time,
    targetBits: TARGETS[settings.target] || 0,
    faceFx: settings.face,
    faces: faces.map((f, i) => ({ ...f, on: on[i] })),
  };
}

function onVision(result, timestampMs) {
  stats.detectFrames++;
  const mirror = state.facing === "user";
  state.hands = mirror ? result.hands.map(mirrorLandmarks) : result.hands;
  if (result.faces) {
    state.faces = mirror ? result.faces.map(mirrorFace) : result.faces;
    state.facesAt = performance.now() / 1000;
  }
  if (result.mask) renderer.setMask(result.mask);

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
  const dot = (p, size) => dctx.fillRect(ox + p.x * vw * s - size / 2, oy + p.y * vh * s - size / 2, size, size);
  dctx.fillStyle = "#0f0";
  for (const lm of state.hands) for (const p of lm) dot(p, 4);
  dctx.fillStyle = "#0ff";
  for (const f of state.faces) for (const p of [f.eyeL, f.eyeR, f.mouth, f.nose]) dot(p, 6);
  dctx.font = "12px ui-monospace, monospace";
  const text = `rendu ${stats.fps} fps · détection ${stats.dps} fps · ${state.trackerMode} · ${state.faces.length} visage(s)`;
  dctx.fillStyle = "rgba(0,0,0,.6)";
  dctx.fillRect(8, 40, dctx.measureText(text).width + 12, 20);
  dctx.fillStyle = "#0f0";
  dctx.fillText(text, 14, 54);
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
window.__tracked = { state, settings, set, onVision: (...a) => onVision(...a) };
