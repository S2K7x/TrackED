import { Renderer } from "./renderer.js";
import { HandTracker } from "./tracker.js";
import { PointsFilter, OneEuro } from "./one-euro.js";
import { paintMask, templateBlob } from "./masks.js";
import { quadFromHands, quadArea, mirrorLandmarks, faceInFrame } from "./geometry.js";
import { mirrorFace, selectFaces, TARGETS } from "./faces.js";
import { OPTIONS, TABS, DEFAULTS, hexToRgb } from "./options.js";
import { Capture } from "./capture.js";
import { drawSpark, drawWaves } from "./art.js";
import { deviceProfile } from "./device.js";
import { classifySign, SignHold } from "./gestures.js";

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

const GROUP_TITLES = {
  effect: "Effect", face: "Face filter", who: "Apply to", target: "Apply effect to",
  shape: "Frame shape", color: "Color", border: "Border", mask: "Face mask", maskArea: "Show masks & 3D",
  accessory: "3D accessory", anchor: "Your model sits", size: "Size",
  timer: "Capture timer", gesture: "Pinch gesture", signs: "One-hand signs",
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
  reveal: [],         // per face 0..1: mask / 3D appear while the frame is on that face
  latency: 60,        // ms between camera capture and tracking result (EMA)
  quadAt: 0,          // performance.now() of the last two-hand detection
  handsSeenAt: 0,     // last time any hand was visible (power saving)
};

const FADE_IN = 8;        // alpha units per second
const FADE_OUT = 5;
const MAX_MISSES = 3;     // keep the frame through a few missed detections (motion blur, occlusion)
const MIN_HAND_SCORE = 0.6; // handedness confidence below this = likely not a hand
const FACE_TTL = 0.6;     // seconds before stale face data is dropped (stretched when face tracking is slow)

const device = deviceProfile();
document.documentElement.classList.toggle("is-mobile", device.mobile);
let extrasEvery = device.extrasEvery; // adapted at runtime from the measured tracking rate

// tuned with tools/tune-filter.mjs (Casiez et al. procedure): ~10% less lag than (1.5, 8) for +0.1 px jitter
const quadFilter = new PointsFilter(4, { minCutoff: 2, beta: 12, dCutoff: 1 });
const stats = { renderFrames: 0, detectFrames: 0, fps: 0, dps: 0, slow: 0, fast: 0, since: performance.now() };

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
    // the wrapper is `display: contents` on mobile (one scrolling row) and a titled section on desktop
    const g = el("div", { className: `group g-${group}` });
    g.append(el("h3", { className: "group-title", textContent: GROUP_TITLES[group] }), ...renderGroup(group));
    nodes.push(g);
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
  if (group === "mask" || group === "accessory") {
    const nodes = OPTIONS[group].map((o) => {
      if (o.upload) {
        const icon = o.upload === "swap"
          ? '<path d="M8 7a4 4 0 1 1 8 0v2a4 4 0 1 1-8 0zM4.5 20c1.2-3.2 4-5 7.5-5s6.3 1.8 7.5 5"/>'
          : o.upload === "model"
            ? '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"/>'
            : '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14"/>';
        const accept = o.upload === "model" ? ".glb,.gltf,model/gltf-binary" : "image/*";
        const b = el("label", { className: "fx upload" + (on(o.value) ? " on" : "") },
          `<i><svg viewBox="0 0 24 24">${icon}</svg></i>${o.label}<input type="file" accept="${accept}">`);
        b.querySelector("input").addEventListener("change", (e) => (o.upload === "model" ? onModelFile(e) : onMaskImage(e, o.upload)));
        return b;
      }
      const b = el("button", { className: "fx" + (on(o.value) ? " on" : "") }, `<i></i>${o.label}`);
      b.querySelector("i").style.background = o.tile;
      b.addEventListener("click", () => set(group, o.value));
      return b;
    });
    if (group === "mask") {
      const tpl = el("button", { className: "chip" }, "Download mask template");
      tpl.addEventListener("click", downloadTemplate);
      nodes.push(tpl);
    }
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
  if (key === "mask" || (key === "color" && COLORED_MASKS.has(settings.mask))) applyMask();
  if (key === "accessory" || key === "color") applyAccessory();
  if ((key === "anchor" || key === "size") && settings.accessory === "model") three?.fitUserModel(settings.anchor, Number(settings.size));
  if (rerender) renderChips();
}

// ---------------- Face masks ----------------
// Built-in masks are painted in the face's canonical UV space; "Your mask" is an
// image painted on the downloadable template; "Face swap" maps a photo's own face
// mesh onto yours. How much the live lighting shades each mask:
const MASK_SHADE = { wire: 0, visor: 0.3, skull: 0.7, gold: 0.95, feline: 0.7, warpaint: 0.6, custom: 0.55 };
const COLORED_MASKS = new Set(["wire", "visor", "warpaint"]);
const userMasks = { custom: null, swap: null }; // { image, swapUV? }
const meshFilters = [];                        // One Euro filters per face slot (468 points each)

function applyMask() {
  if (!renderer) return;
  const m = settings.mask;
  if (m === "none") return renderer.setFaceMask(null);
  if (m === "custom" || m === "swap") {
    const u = userMasks[m];
    if (!u) { renderer.setFaceMask(null); return; }
    return renderer.setFaceMask(u.image, { shade: MASK_SHADE.custom, swapUV: u.swapUV });
  }
  renderer.setFaceMask(paintMask(m, settings.color), { shade: MASK_SHADE[m] ?? 0.6 });
}

async function onMaskImage(e, kind) {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f || !renderer) return;
  const image = await createImageBitmap(f, { imageOrientation: "from-image", premultiplyAlpha: "none" });
  if (kind === "swap") {
    flash("Finding the face in your photo…");
    let uv = null;
    try { uv = await tracker.analyze(await createImageBitmap(image)); } catch (err) { console.warn(err); }
    if (!uv) { flash("No face found in that photo. Try a clear, front-facing one."); image.close(); return; }
    userMasks.swap?.image.close?.();
    userMasks.swap = { image, swapUV: uv };
  } else {
    userMasks.custom?.image.close?.();
    userMasks.custom = { image };
  }
  set("mask", kind);
  flash(kind === "swap" ? "Face swap ready" : "Mask loaded");
}

async function downloadTemplate() {
  const blob = await templateBlob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: "tracked-mask-template.png" });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  flash("Template saved: paint inside the outline, keep eyes and mouth transparent");
}

// ---------------- 3D accessories (three.js, loaded on first use) ----------------
let three = null, threeLoading = null;
function ensureThree() {
  if (three) return Promise.resolve(three);
  if (!renderer) return Promise.resolve(null);
  threeLoading ??= (async () => {
    flash("Loading 3D engine…");
    const { ThreeLayer } = await import("./three-layer.js");
    three = new ThreeLayer(canvas, renderer.gl, { samples: device.tier === "low" ? 0 : 4 });
    return three;
  })().catch((err) => { console.error(err); flash("3D is not available on this device"); threeLoading = null; return null; });
  return threeLoading;
}

async function applyAccessory() {
  const a = settings.accessory;
  if (a === "none") { three?.setAccessory(null); return; }
  const t = await ensureThree();
  if (!t) return;
  if (a === "model") {
    if (t.userModel) t.fitUserModel(settings.anchor, Number(settings.size));
    else t.setAccessory(null);
  } else {
    t.setAccessory(a, settings.color);
  }
}

async function onModelFile(e) {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f || !renderer) return;
  const t = await ensureThree();
  if (!t) return;
  flash("Loading your model…");
  try {
    await t.loadModel(await f.arrayBuffer(), settings.anchor, Number(settings.size));
    set("accessory", "model");
    flash("Model ready. Pick where it sits below.");
  } catch (err) {
    console.error(err);
    flash("Couldn't read that model. Use a single .glb file.");
  }
}

/** Smooths each face mesh with One Euro filters (faces are matched by position). */
function smoothMeshes(faces, t) {
  faces.sort((a, b) => a.nose.x - b.nose.x);
  if (faces.length !== meshFilters.count) meshFilters.forEach((f) => f.reset());
  meshFilters.count = faces.length;
  faces.forEach((f, i) => {
    if (!f.mesh) return;
    meshFilters[i] ??= new MeshFilter();
    f.mesh = meshFilters[i].filter(f.mesh, t);
  });
}

class MeshFilter {
  constructor() { this.f = Array.from({ length: 468 * 2 }, () => new OneEuro({ minCutoff: 2, beta: 6 })); }
  reset() { this.f.forEach((x) => x.reset()); }
  filter(a, t) {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = this.f[i].filter(a[i], t);
    return out;
  }
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
  if (renderer?.frozen) toggleFreeze();
  await startCamera();
});
// ---------------- Capture (with optional countdown: both hands are busy making the frame) ----------------
let countdownTimer = null;
function withTimer(action) {
  if (!capture) return;
  if (countdownTimer) { cancelCountdown(); return; }       // tap again to cancel
  const secs = Number(settings.timer) || 0;
  if (!secs) { action(); return; }
  const el = $("#countdown");
  let left = secs;
  const tick = () => {
    if (left === 0) { cancelCountdown(); action(); return; }
    el.textContent = left;
    el.hidden = false;
    el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); // restart the animation
    buzz(8);
    left--;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}
function cancelCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  $("#countdown").hidden = true;
}

function takePhoto() {
  capture.photo();
  buzz(20);
  const f = $("#flash");
  f.hidden = false;
  f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
  setTimeout(() => { f.hidden = true; }, 450);
}

let recTimer = null;
function toggleRecording() {
  const on = capture.toggleRecording();
  $("#rec").classList.toggle("on", on);
  const pill = $("#rec-pill");
  pill.hidden = !on;
  $("#status").style.visibility = on ? "hidden" : "";
  clearInterval(recTimer);
  buzz(on ? 30 : 15);
  if (on) {
    const t0 = performance.now();
    const tick = () => {
      const s = Math.floor((performance.now() - t0) / 1000);
      pill.querySelector("span").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };
    tick();
    recTimer = setInterval(tick, 500);
  }
}

$("#photo").addEventListener("click", () => withTimer(takePhoto));
// stopping a recording is immediate; only starting one uses the timer
$("#rec").addEventListener("click", () => (capture?.recorder ? toggleRecording() : withTimer(toggleRecording)));
$("#freeze").addEventListener("click", toggleFreeze);

function toggleFreeze() {
  if (!renderer) return;
  const on = !renderer.frozen;
  renderer.setFrozen(on ? video : null);
  $("#freeze").classList.toggle("on", on);
  flash(on ? "Frozen: move the frame around" : "Live");
  buzz(12);
}

function buzz(ms) {
  if (device.mobile) navigator.vibrate?.(ms);
}

// Keep the screen awake while the camera runs (phones dim after ~30 s without touches,
// and here both hands are busy). Re-acquired when the page becomes visible again.
let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* not allowed / unsupported */ }
}

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

// ---------------- Layout ----------------
// Mobile: edge-to-edge camera (cover) with a bottom sheet, like a camera app.
// Desktop: the video is a rounded card on the left, settings live in a sidebar.
const desktopMQ = matchMedia("(min-width: 900px)");
const panel = $("#panel");
const root = document.documentElement.style;

function fitStage() {
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const W = innerWidth, H = innerHeight;
  const desk = desktopMQ.matches;
  const box = desk
    ? { x: 16, y: 76, w: W - panel.offsetWidth - 48, h: H - 92 }
    : { x: 0, y: 0, w: W, h: H };
  const contain = Math.min(box.w / vw, box.h / vh);
  const cover = Math.max(box.w / vw, box.h / vh);
  // fill the phone screen, unless that would crop away more than ~25% of the picture (hands at the edges)
  const bleed = !desk && contain / cover > 0.75;
  const k = bleed ? cover : contain;
  const w = Math.round(vw * k), h = Math.round(vh * k);
  const left = Math.round(box.x + (box.w - w) / 2), top = Math.round(box.y + (box.h - h) / 2);
  Object.assign(stage.style, { width: `${w}px`, height: `${h}px`, left: `${left}px`, top: `${top}px` });
  stage.classList.toggle("bleed", bleed);
  // visible part of the stage, used to place overlays (status, toast, HUD) over the video
  const vl = Math.max(0, left), vt = Math.max(0, top);
  root.setProperty("--stage-left", `${vl}px`);
  root.setProperty("--stage-top", `${vt}px`);
  root.setProperty("--stage-w", `${Math.min(W, left + w) - vl}px`);
  root.setProperty("--stage-h", `${Math.min(H, top + h) - vt}px`);
}
addEventListener("resize", fitStage);
desktopMQ.addEventListener("change", fitStage);
new ResizeObserver(() => {
  root.setProperty("--sheet-h", `${panel.offsetHeight}px`);
  fitStage();
}).observe(panel);

// ---------------- Keyboard (desktop) ----------------
addEventListener("keydown", (e) => {
  if (!renderer || e.target.closest?.("input") || e.metaKey || e.ctrlKey || e.altKey) return;
  const list = OPTIONS.effect.map((o) => o.value);
  const i = list.indexOf(settings.effect);
  if (e.key === "ArrowRight") set("effect", list[(i + 1) % list.length]);
  else if (e.key === "ArrowLeft") set("effect", list[(i + list.length - 1) % list.length]);
  else if (e.key === "p" || e.key === "P") $("#photo").click();
  else if (e.key === "r" || e.key === "R") $("#rec").click();
  else if (e.key === "d" || e.key === "D") $("#debug").click();
  else if (e.key === "f" || e.key === "F") toggleFreeze();
  else if (e.key === "Escape" && countdownTimer) cancelCountdown();
  else return;
  e.preventDefault();
});

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
  applyMask();
  applyAccessory();
  tracker = new HandTracker({ detectWidth: device.detectWidth });
  keepAwake();
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
  // warm up the face model while idle, so the first mask / face filter / 3D accessory is instant
  if (device.tier !== "low") (window.requestIdleCallback || setTimeout)(() => tracker.warm(["face"]), { timeout: 4000 });
}

async function startCamera() {
  video.srcObject?.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    // portrait screens (phones) ask for a portrait stream so the camera fills the screen
    video: (() => {
      const short = device.cameraHeight, long = Math.round(short * 16 / 9);
      const portrait = innerHeight > innerWidth;
      return { facingMode: state.facing, width: { ideal: portrait ? short : long }, height: { ideal: portrait ? long : short }, frameRate: { ideal: 30 } };
    })(),
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
  // power saving: with no hand in sight for 3 s, track every other frame (a hand
  // entering the picture is still picked up within ~70 ms)
  const idle = t - state.handsSeenAt > 3000 && !(settings.maskArea === "always" && (settings.mask !== "none" || settings.accessory !== "none"));
  if (!idle || (state.idleTick = !state.idleTick)) tracker.submit(video, t, extrasWanted());
  update(t / 1000);
  const fs = frameState(t / 1000);
  renderer.draw(video, fs);
  const area = settings.maskArea;
  if (settings.mask !== "none") {
    const inFrame = area === "frame";
    if (!inFrame || (fs.quad && fs.alpha > 0)) {
      renderer.drawMasks(fs.faces, { inFrame, alpha: inFrame ? fs.alpha : 1, mirror: fs.mirror });
    }
  }
  if (three?.active) {
    const clip = area === "frame";
    // fade: follows the frame when clipped, the per-face reveal when "appear & disappear"
    const fade = area === "always" ? 1 : area === "frame" ? (fs.quad ? fs.alpha : 0) : Math.max(0, ...fs.faces.map((f) => f.reveal ?? 0));
    if (fade > 0.001) {
      const layer = three.render(fs.faces, { width: canvas.width, height: canvas.height, mirror: fs.mirror, time: fs.time });
      if (layer) renderer.compositeLayer(layer, { clip, fade: smoothstep(fade) });
    }
  }
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
  const mesh = settings.mask !== "none" && (settings.mask !== "custom" && settings.mask !== "swap" || !!userMasks[settings.mask]);
  const pose = settings.accessory !== "none" && !!three?.active;
  const maskAlways = (mesh || pose) && settings.maskArea === "always";
  if (!state.quad && !maskAlways) return {};
  const face = settings.face !== "none" || mesh || pose;
  const seg = !!state.quad && TARGETS[settings.target] != null;
  if (!face && !seg) return {};
  state.frameNo++;
  if (state.frameNo % extrasEvery) return {};          // device-dependent cadence
  if (face && seg) return (state.frameNo / extrasEvery) % 2 ? { face: true, mesh, pose } : { seg: true };
  return { face, mesh, pose, seg };
}

/**
 * The frame shown on screen: the filtered corners pushed forward along their
 * filtered velocity by the tracking latency + the time since that result,
 * so the frame stays glued to the hands instead of trailing behind them.
 */
function displayQuad(nowMs) {
  if (!state.quad || state.missStreak > 0) return state.quad;
  const lead = (state.latency + (nowMs - state.quadAt)) / 1000;
  return quadFilter.predict(lead) || state.quad;
}

function frameState(time) {
  // keep the last faces for ~3 face-model updates, so slow devices don't make masks flicker
  const ttl = Math.max(FACE_TTL, (3 * extrasEvery) / Math.max(1, stats.dps));
  const faces = time - state.facesAt < ttl ? state.faces : [];
  const on = selectFaces(faces, settings.who);
  return {
    quad: displayQuad(time * 1000),
    alpha: state.alpha,
    effect: settings.effect,
    shape: settings.shape,
    border: settings.border,
    color: hexToRgb(settings.color),
    mirror: state.facing === "user",
    time,
    targetBits: TARGETS[settings.target] || 0,
    refineMask: device.tier !== "low",
    faceFx: settings.face,
    faces: faces.map((f, i) => ({ ...f, on: on[i], reveal: state.reveal[i] ?? 0 })),
  };
}

function onVision(result, timestampMs) {
  stats.detectFrames++;
  const now = performance.now();
  state.latency += (now - timestampMs - state.latency) * 0.1;
  const mirror = state.facing === "user";
  // drop low-confidence hands (false positives on hand-like shapes) using MediaPipe's handedness score
  const info = result.handInfo || [];
  state.handInfo = info; // raw handedness / scores (debug HUD, tests)
  const keep = result.hands.map((_, i) => (info[i]?.score ?? 1) >= MIN_HAND_SCORE);
  let hands = result.hands.filter((_, i) => keep[i]);
  const labels = info.filter((_, i) => keep[i]).map((h) => h.label);
  // two confident hands with the SAME handedness are two people's hands (or a
  // misdetection), not one person framing: don't build a frame from them
  if (hands.length === 2 && labels[0] && labels[0] === labels[1]
      && info.filter((_, i) => keep[i]).every((h) => h.score > 0.85)) hands = hands.slice(0, 1);
  state.hands = mirror ? hands.map(mirrorLandmarks) : hands;
  state.world = hands.length === 1 ? result.world : null;
  if (result.faces) {
    const faces = mirror ? result.faces.map(mirrorFace) : result.faces;
    smoothMeshes(faces, timestampMs / 1000);
    state.faces = faces;
    state.facesAt = performance.now() / 1000;
  }
  if (result.mask) renderer.setMask(result.mask);

  const aspect = video.videoWidth / video.videoHeight || 1;
  if (state.hands.length === 2) {
    const q = quadFromHands(state.hands[0], state.hands[1]);
    state.quad = quadFilter.filter(q, timestampMs / 1000);
    state.quadAt = now;
    const collapsed = quadArea(q, aspect) < 0.0004; // fingers pinched together → close the frame
    detectPinch(collapsed);
    state.collapsed = collapsed;
    state.missStreak = 0;
  } else {
    state.missStreak++;
  }
  const n = state.hands.length;
  if (n) state.handsSeenAt = now;
  showStatus(n === 2 ? "" : n === 1 ? MSG.showSecond : MSG.showBoth);
  readSign(n === 1 ? state.hands[0] : null, now / 1000);
}

// ---------------- One-hand signs (hands-free shortcuts) ----------------
// 👍 hold → photo (with the timer) · ✌️ → next effect · 🖐 → freeze / unfreeze
const SIGNS = {
  thumbs_up: { icon: "👍", label: "Photo", run: () => withTimer(takePhoto) },
  victory: { icon: "✌️", label: "Next effect", run: () => nextEffect() },
  open_palm: { icon: "🖐", label: "Freeze", run: () => toggleFreeze() },
};
const signHold = new SignHold(0.6);
function readSign(hand, t) {
  const pill = $("#sign");
  if (settings.signs !== "on" || !hand) { signHold.reset(); pill.hidden = true; return; }
  const aspect = video.videoWidth / video.videoHeight || 1;
  // world landmarks are metric 3D (independent of mirroring and perspective) → more robust finger shapes
  const r = signHold.update(classifySign(hand, aspect, state.world), t);
  if (!r.sign) { pill.hidden = true; return; }
  const sgn = SIGNS[r.sign];
  pill.hidden = false;
  pill.querySelector("b").textContent = sgn.icon;
  pill.querySelector("span").textContent = sgn.label;
  pill.style.setProperty("--p", r.progress.toFixed(3));
  if (r.fire) { sgn.run(); buzz(18); }
}

function nextEffect() {
  const list = OPTIONS.effect.filter((o) => o.value !== "none");
  const i = list.findIndex((o) => o.value === settings.effect);
  const next = list[(i + 1) % list.length];
  set("effect", next.value);
  flash(next.label);
}

const smoothstep = (x) => x * x * (3 - 2 * x);

// Quick pinch (close the frame and reopen it within 0.7 s) → next effect.
let pinchedAt = 0;
function detectPinch(collapsed) {
  const now = performance.now();
  if (collapsed && !state.collapsed) pinchedAt = now;
  if (!collapsed && state.collapsed && settings.gesture === "on" && now - pinchedAt < 700) {
    nextEffect();
    buzz(15);
  }
}

let lastUpdate = 0;
function update(t) {
  const dt = Math.min(0.1, t - (lastUpdate || t));
  lastUpdate = t;
  // "When the frame is on a face": each face fades in while the frame covers it, out when it leaves
  const frameOn = state.quad && state.alpha > 0.5 && !state.collapsed;
  state.faces.forEach((f, i) => {
    const target = settings.maskArea !== "face" || (frameOn && faceInFrame(f, state.quad)) ? 1 : 0;
    const r = state.reveal[i] ?? 0;
    // frame-rate independent easing: ~0.25 s to appear, ~0.35 s to disappear
    const k = 1 - Math.exp(-dt * (target > r ? 12 : 9));
    const next = r + (target - r) * k;
    state.reveal[i] = Math.abs(target - next) < 0.003 ? target : next;
  });
  state.reveal.length = state.faces.length;
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
  $("#hud-mode").textContent = `${state.trackerMode === "worker" ? "Web Worker" : "Main thread"} · ${device.mobile ? "mobile" : "desktop"} ${device.tier} · extras 1/${extrasEvery} · ${Math.round(state.latency)} ms · ${Math.round(renderer.scale * 100)}% res`;
}

function countFps(t) {
  stats.renderFrames++;
  if (t - stats.since >= 1000) {
    const k = 1000 / (t - stats.since);
    stats.fps = Math.round(stats.renderFrames * k);
    stats.dps = Math.round(stats.detectFrames * k);
    stats.renderFrames = stats.detectFrames = 0;
    // rendering can't keep up → lower the internal resolution a step (and back up when there's headroom)
    if (stats.fps < 22 && ++stats.slow >= 3 && renderer.scale > 0.55) { renderer.scale = +(renderer.scale - 0.15).toFixed(2); stats.slow = 0; }
    else if (stats.fps >= 28 && ++stats.fast >= 5 && renderer.scale < 1) { renderer.scale = Math.min(1, +(renderer.scale + 0.15).toFixed(2)); stats.fast = 0; }
    if (stats.fps >= 22) stats.slow = 0;
    if (stats.fps < 28) stats.fast = 0;
    // tracking can't keep up → run the heavy face/segmentation models less often (and back again)
    if (state.quad && stats.dps < 12 && extrasEvery < 4) extrasEvery++;
    else if (stats.dps > 24 && extrasEvery > device.extrasEvery) extrasEvery--;
    stats.since = t;
  }
}

// Pause camera when the page is hidden (saves battery), resume when visible.
document.addEventListener("visibilitychange", () => {
  if (!video.srcObject) return;
  if (document.hidden) video.pause();
  else { video.play().catch(() => {}); keepAwake(); }
});

// Cache models / WASM / libraries for instant second launches and offline use.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((err) => console.warn("service worker:", err)));
}

// test hook (used by automated browser tests only)
window.__tracked = { state, settings, set, onVision: (...a) => onVision(...a), get renderer() { return renderer; }, get three() { return three; } };
