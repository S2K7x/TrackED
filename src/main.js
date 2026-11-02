import { Renderer } from "./renderer.js";
import { HandTracker } from "./tracker.js";
import { PointsFilter } from "./one-euro.js";
import { quadFromHands, quadArea, mirrorLandmarks } from "./geometry.js";
import { mirrorFace, selectFaces, TARGETS } from "./faces.js";
import { OPTIONS, TABS, DEFAULTS, hexToRgb } from "./options.js";
import { Capture } from "./capture.js";
import { drawSpark, drawWaves } from "./art.js";

const $ = (s) => document.querySelector(s);
const video = $("#cam");
const canvas = $("#out");
const stage = $("#stage");
const debugCanvas = $("#debug-layer");
const statusText = $("#status span");

const MSG = {
  loading: "Loading hand model…",
  showBoth: "Show both hands in an L shape",
  showSecond: "Now show your second hand",
};

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
      const valid = k === "color" ? /^#[0-9a-f]{6}$/i.test(saved[k]) : OPTIONS[k]?.some((o) => o.value === saved[k]);
      if (valid) s[k] = saved[k];
    }
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  try { localStorage.setItem("tracked.settings", JSON.stringify(settings)); } catch { /* private mode */ }
}

// ---------------- Decorative line art ----------------
drawSpark($("#spark-rays"));
drawWaves($("#waves"));

// ---------------- UI ----------------
let activeTab = "effect";
const tabsEl = $("#tabs");
const chipsEl = $("#chips");
const el = (tag, props = {}, html) => {
  const n = Object.assign(document.createElement(tag), props);
  if (html != null) n.innerHTML = html;
  return n;
};

function renderTabs() {
  tabsEl.replaceChildren(...TABS.map((t) => {
    const b = el("button", { className: t.id === activeTab ? "on" : "", role: "tab" }, `<i class="dot"></i>${t.label}`);
    b.setAttribute("aria-selected", t.id === activeTab);
    b.addEventListener("click", () => { activeTab = t.id; renderTabs(); renderChips(); });
    return b;
  }));
}

function renderChips() {
  document.documentElement.style.setProperty("--pick", settings.color);
  const tab = TABS.find((t) => t.id === activeTab);
  const nodes = [];
  tab.groups.forEach((group, gi) => {
    if (gi > 0) nodes.push(el("span", { className: "sep" }));
    nodes.push(...renderGroup(group));
  });
  chipsEl.replaceChildren(...nodes);
  chipsEl.querySelector(".on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function renderGroup(group) {
  const on = (v) => settings[group] === v;
  if (group === "effect") {
    const nodes = OPTIONS.effect.map((o) => {
      const b = el("button", { className: "fx" + (on(o.value) ? " on" : "") }, `<i></i>${o.label}`);
      b.querySelector("i").style.background = o.tile;
      b.addEventListener("click", () => set("effect", o.value));
      return b;
    });
    const up = el("label", { className: "fx upload" },
      `<i><svg viewBox="0 0 24 24"><path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14"/></svg></i>Your image<input type="file" accept="image/*">`);
    up.querySelector("input").addEventListener("change", onImagePicked);
    nodes.push(up);
    return nodes;
  }
  if (group === "shape") {
    return OPTIONS.shape.map((o) => {
      const b = el("button", { className: "shape" + (on(o.value) ? " on" : "") }, `<svg viewBox="0 0 24 24">${o.icon}</svg>${o.label}`);
      b.addEventListener("click", () => set("shape", o.value));
      return b;
    });
  }
  if (group === "color") {
    const nodes = OPTIONS.color.map((c) => {
      const b = el("button", { className: "swatch" + (settings.color.toLowerCase() === c.value ? " on" : ""), title: c.label });
      b.style.setProperty("--c", c.value);
      b.setAttribute("aria-label", c.label);
      b.addEventListener("click", () => set("color", c.value));
      return b;
    });
    const pick = el("label", { className: "chip" }, `Custom<input type="color" value="${settings.color}">`);
    pick.querySelector("input").addEventListener("input", (e) => set("color", e.target.value, false));
    nodes.push(pick);
    return nodes;
  }
  return OPTIONS[group].map((o) => {
    const b = el("button", { className: "chip" + (on(o.value) ? " on" : "") }, o.label);
    b.addEventListener("click", () => set(group, o.value));
    return b;
  });
}

function set(key, value, rerender = true) {
  settings[key] = value;
  saveSettings();
  if (key === "color") document.documentElement.style.setProperty("--pick", value);
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
  $("#hud").hidden = !state.debug;
});
$("#flip").addEventListener("click", async () => {
  state.facing = state.facing === "user" ? "environment" : "user";
  await startCamera();
});
$("#photo").addEventListener("click", () => capture?.photo());

let recTimer = null;
$("#rec").addEventListener("click", (e) => {
  if (!capture) return;
  const on = capture.toggleRecording();
  e.currentTarget.classList.toggle("on", on);
  const pill = $("#rec-pill");
  pill.hidden = !on;
  $("#status").style.visibility = on ? "hidden" : "";
  clearInterval(recTimer);
  if (on) {
    const t0 = performance.now();
    const tick = () => {
      const s = Math.floor((performance.now() - t0) / 1000);
      pill.querySelector("span").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };
    tick();
    recTimer = setInterval(tick, 500);
  }
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

// ---------------- Layout: the video is a rounded card, "contain"-fitted ----------------
function fitStage() {
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const W = innerWidth, H = innerHeight;
  const s = Math.min(W / vw, H / vh);
  const full = Math.abs(W - vw * s) < 2 && Math.abs(H - vh * s) < 2;
  // leave a margin around the card unless the video already fills the screen
  const m = full ? 0 : Math.min(24, W * 0.03);
  const k = Math.min((W - 2 * m) / vw, (H - 2 * m) / vh);
  stage.style.width = `${Math.round(vw * k)}px`;
  stage.style.height = `${Math.round(vh * k)}px`;
  stage.style.borderRadius = full ? "0" : "";
}
addEventListener("resize", fitStage);

// ---------------- Startup ----------------
async function start() {
  $("#start").hidden = true;
  $("#app").hidden = false;
  fitStage();
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    showStatus(err.message);
    return;
  }
  capture = new Capture(canvas, (msg) => flash(msg));
  tracker = new HandTracker();
  tracker.onResult = onVision;
  showStatus(MSG.loading);
  try {
    const [mode] = await Promise.all([tracker.init(), startCamera()]); // in parallel
    state.trackerMode = mode;
    $("#hud-mode").textContent = mode === "worker" ? "Web Worker" : "Main thread";
  } catch (err) {
    showStatus("Error: " + (err?.message || err));
    console.error(err);
    return;
  }
  showStatus(MSG.showBoth);
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
  fitStage();
  quadFilter.reset();
  state.quad = null;
  state.faces = [];
}

function showStatus(msg) {
  if (statusText.textContent !== msg) statusText.textContent = msg;
}

let flashTimer;
function flash(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { t.hidden = true; }, 2200);
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
  showStatus(n === 2 ? "" : n === 1 ? MSG.showSecond : MSG.showBoth);
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
  const w = stage.clientWidth, h = stage.clientHeight, dpr = devicePixelRatio || 1;
  if (debugCanvas.width !== Math.round(w * dpr) || debugCanvas.height !== Math.round(h * dpr)) {
    debugCanvas.width = Math.round(w * dpr);
    debugCanvas.height = Math.round(h * dpr);
  }
  dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dctx.clearRect(0, 0, w, h);
  const dot = (p, r, fill) => {
    dctx.beginPath();
    dctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    dctx.fillStyle = fill;
    dctx.fill();
  };
  for (const lm of state.hands) for (const p of lm) dot(p, 3, "rgba(255,255,255,.9)");
  for (const lm of state.hands) for (const i of [4, 8]) dot(lm[i], 5, "#d4ff3a");
  for (const f of state.faces) for (const p of [f.eyeL, f.eyeR, f.mouth, f.nose]) dot(p, 4, "#d4ff3a");
  $("#hud-fps").textContent = stats.fps;
  $("#hud-dps").textContent = stats.dps;
  $("#hud-faces").textContent = state.faces.length;
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
