import { Renderer } from "./renderer.js";
import { HandTracker } from "./tracker.js";
import { PointsFilter, OneEuro } from "./one-euro.js";
import { paintMask, templateBlob } from "./masks.js";
import { quadFromHands, quadArea, mirrorLandmarks, faceInFrame } from "./geometry.js";
import { mirrorFace, selectFaces, TARGETS } from "./faces.js";
import { PRESETS } from "./options.js";
import { OPTIONS, TABS, MUSIC_TABS, POWER_TABS, DEFAULTS, hexToRgb, exclusiveConflicts } from "./options.js";
import { POWER_GUIDE, powerById, powerWants } from "./powers/catalog.js";
import { Capture } from "./capture.js";
import { AudioEngine } from "./music/audio.js";
import { MusicMode, lessonSettings, SONGS, RHYTHMS } from "./music/controller.js";
import { MUSIC_GUIDES, MUSIC_GUIDE_ORDER } from "./music/learn.js";
import { drawSpark, drawWaves } from "./art.js";
import { deviceProfile } from "./device.js";
import { classifySign, SignHold } from "./gestures.js";
import { Tutorial, STEPS, pickHint, HINTS } from "./onboarding.js";
import { GUIDES, GUIDE_CHIP } from "./guides.js";
import { FIT_FIELDS, DEFAULT_FIT, FitStore, modelKey, clampFit, isDefaultFit } from "./model-fit.js";
import { describeCameraError, constraintLadder, checkUpload, fitTextureSize, FailureBudget } from "./errors.js";

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
  accessory: "3D accessory", anchor: "Your model sits", size: "Size", fit: "Fine-tune your model",
  timer: "Capture timer", gesture: "Pinch gesture", signs: "One-hand signs",
  instrument: "Instrument", sound: "Sound", looper: "Looper", scale: "Scale", root: "Key",
  octave: "Range", snap: "Theremin pitch", reverb: "Reverb", echo: "Echo", midi: "MIDI output",
  preset: "Jam presets: one tap to start", style: "Band style", progression: "Chord progression", tempo: "Tempo",
  metronome: "Metronome", kit: "Drum kit", lesson: "Lessons",
  power: "Superpower", plate: "Get started", intensity: "Intensity", cloak: "Invisibility look", cloneCount: "Clones",
  activation: "Invisibility, time stop, clones", training: "Training", powerSound: "Sound", shake: "Screen shake",
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
  previewUntil: 0,    // while fine-tuning a 3D model, it shows on every face (live preview)
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
    for (const c of exclusiveConflicts(s, "mask", s.mask)) s[c.key] = c.value; // saved before the rule existed
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

const isMusic = () => settings.mode === "music";
const isPowers = () => settings.mode === "powers";
const currentTabs = () => (isMusic() ? MUSIC_TABS : isPowers() ? POWER_TABS : TABS);
const tabByMode = { effects: "effect", music: "instrument", powers: "power" };

function renderTabs() {
  // mode switch: Effects | Music (separate tabs, separate settings)
  $("#modes").replaceChildren(...OPTIONS.mode.map((o) => {
    const b = el("button", { className: settings.mode === o.value ? "on" : "", role: "radio" }, o.label);
    b.setAttribute("aria-checked", settings.mode === o.value);
    b.addEventListener("click", () => setMode(o.value));
    return b;
  }));
  if (!currentTabs().some((t) => t.id === activeTab)) activeTab = tabByMode[settings.mode];
  tabsEl.replaceChildren(...currentTabs().map((t) => {
    const b = el("button", { className: t.id === activeTab ? "on" : "", role: "tab" }, `<i class="dot"></i>${t.label}`);
    b.setAttribute("aria-selected", t.id === activeTab);
    b.addEventListener("click", () => { activeTab = t.id; tabByMode[settings.mode] = t.id; renderTabs(); renderChips(); });
    return b;
  }));
  $("#panel").classList.toggle("music", isMusic());
  $("#panel").classList.toggle("powers", isPowers());
}

function renderChips() {
  document.documentElement.style.setProperty("--pick", settings.color);
  const tab = currentTabs().find((t) => t.id === activeTab) ?? currentTabs()[0];
  const nodes = [];
  tab.groups.forEach((group) => {
    const items = renderGroup(group);
    if (!items.length) return;                // e.g. the fit panel before a model is loaded
    if (nodes.length) nodes.push(el("span", { className: "sep" }));
    // the wrapper is `display: contents` on mobile (one scrolling row) and a titled section on desktop
    const g = el("div", { className: `group g-${group}` });
    g.append(el("h3", { className: "group-title", textContent: GROUP_TITLES[group] }), ...items);
    nodes.push(g);
  });
  // "make your own" guide, in the first group of every customisable tab
  if (GUIDES[activeTab]) {
    const b = el("button", { className: "chip guide" },
      `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.01"/></svg>${GUIDE_CHIP[activeTab]}`);
    b.addEventListener("click", () => openGuide(activeTab));
    nodes.find((n) => n.classList?.contains("group"))?.append(b);
  }
  chipsEl.replaceChildren(...nodes);
  chipsEl.querySelector(".on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function renderGroup(group) {
  const on = (v) => settings[group] === v;
  if (group === "plate") return renderPowerStart();
  if (group === "instrument" || group === "power") {
    return OPTIONS[group].map((o) => {
      const b = el("button", { className: "fx" + (on(o.value) ? " on" : "") }, `<i></i>${o.label}`);
      b.querySelector("i").style.background = o.tile;
      b.addEventListener("click", () => set(group, o.value));
      return b;
    });
  }
  if (group === "looper") {
    const st = music?.looper.state ?? "idle";
    const label = { idle: "● Record a loop", recording: "■ Stop & play loop", playing: "✕ Clear loop" }[st];
    const b = el("button", { className: "chip" + (st !== "idle" ? " on" : "") }, label);
    b.addEventListener("click", toggleLoop);
    return [b];
  }
  if (group === "preset") {
    return PRESETS.map((pr) => {
      const b = el("button", { className: "chip" }, pr.label);
      b.addEventListener("click", () => applyPreset(pr));
      return b;
    });
  }
  if (group === "lesson") return renderLessons();
  if (group === "midi" && !navigator.requestMIDIAccess) return [el("span", { className: "chip", textContent: "MIDI needs Chrome or Edge" })];
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
    } else {
      // Blender scene with the exact head the app tracks: model around it, export .glb, pick "As modelled"
      nodes.push(el("a", { className: "chip", href: "assets/reference/tracked-reference-head.blend", download: "" }, "Download Blender head"));
    }
    return nodes;
  }
  if (group === "fit") return renderFitPanel();
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
  if (key === "effect" && value !== settings[key]) onboard.effectChanges++;
  const conflicts = exclusiveConflicts(settings, key, value);
  settings[key] = value;
  for (const c of conflicts) {
    settings[c.key] = c.value;
    if (c.key === "mask") applyMask();
    if (c.key === "accessory") applyAccessory();
    const picked = OPTIONS[key].find((o) => o.value === value)?.label ?? value;
    flash(`${c.label} switched off: ${picked} and ${c.label} are worn separately`);
  }
  saveSettings();
  if (key === "color") document.documentElement.style.setProperty("--pick", value);
  if (key === "mask" || (key === "color" && COLORED_MASKS.has(settings.mask))) applyMask();
  if (key === "accessory" || key === "color") applyAccessory();
  if (MUSIC_KEYS.has(key)) applyMusicSettings(key);
  if (POWER_KEYS.has(key) || (key === "color" && isPowers())) applyPowerSettings(key);
  if ((key === "anchor" || key === "size") && settings.accessory === "model") three?.fitUserModel(settings.anchor, Number(settings.size), modelFit);
  if (rerender) renderChips();
}

// ---------------- Music mode ----------------
// A separate mode with its own tabs: the frame, masks and 3D are switched off,
// only the hand model runs (lowest latency), and the hands play an instrument.
const MUSIC_KEYS = new Set(["instrument", "sound", "scale", "root", "octave", "snap", "reverb", "echo", "midi", "style", "progression", "tempo", "metronome", "kit"]);
const engine = new AudioEngine();
let music = null;

async function setMode(mode) {
  if (mode === settings.mode) return;
  const prev = settings.mode;
  if (mode === "music" || mode === "powers") {
    try {
      await engine.ensure();             // runs inside the click: allowed to start audio
    } catch (err) {
      // music can't work without audio; powers simply stay silent
      if (mode === "music") { flash(err.message); renderTabs(); renderChips(); return; }
    }
  }
  if (mode === "powers" && !(await ensurePowers())) { renderTabs(); renderChips(); return; }
  settings.mode = mode;
  saveSettings();
  if (prev === "music") {
    music?.deactivate();
    $("#lesson").hidden = true;
    $("#music-layer").hidden = true;
    $("#music-layer").getContext("2d").clearRect(0, 0, 1e5, 1e5);
  }
  if (prev === "powers") {
    powers?.deactivate();
    $("#power-layer").hidden = true;
  }
  if (mode === "music") {
    if (!music) { music = new MusicMode(engine, $("#music-layer")); music.onLessonChange = renderLesson; }
    applyMusicSettings();
    $("#music-layer").hidden = false;
    showStatus("Show your hands to play");
  } else if (mode === "powers") {
    applyPowerSettings("power");
    $("#power-layer").hidden = false;
  }
  if (mode !== "effects" && tutorial.active) { tutorial.stop(); $("#coach").hidden = true; }
  if (capture?.recorder) toggleRecording(); // a clip never mixes two modes
  renderTabs();
  renderChips();
}

async function applyMusicSettings(key) {
  if (!music) return;
  music.configure(settings);
  engine.setReverb(settings.reverb);
  engine.setEcho(settings.echo === "on");
  if (key === "midi") {
    if (settings.midi === "on") {
      try {
        const name = await engine.enableMidi();
        flash(name ? `Sending MIDI to ${name}` : "No MIDI output found. Connect a device or a virtual port.");
      } catch (err) {
        flash(err.message);
        settings.midi = "off";
        renderChips();
      }
    } else engine.disableMidi();
  }
}

function toggleLoop() {
  if (!music) return;
  const st = music.toggleLoop(performance.now() / 1000);
  flash({ recording: "Recording a loop… play, then press again to loop it", playing: "Loop playing. Keep jamming on top!", idle: "Loop cleared" }[st]);
  renderChips();
}

// ---------------- Superpower mode ----------------
// Its own tabs and settings. Hands always run; the light body segmenter and
// the face model only when the chosen power needs them. Everything is drawn
// on the main canvas (src/powers/fx-gl.js), so photos and videos include it.
const POWER_KEYS = new Set(["power", "intensity", "cloak", "cloneCount", "activation", "training", "powerSound", "shake"]);
const BEST_KEY = "tracked.powerBest";
let powers = null, powersLoading = null;

/** Loads the superpower code on first use (it isn't needed to start the app). */
function ensurePowers() {
  if (powers) return Promise.resolve(powers);
  if (!renderer) return Promise.resolve(null);
  powersLoading ??= import("./powers/controller.js").then(({ PowersMode }) => {
    powers = new PowersMode({ renderer, engine, overlay: $("#power-layer") });
    try { powers.bestSaved = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { /* storage blocked */ }
    powers.onBest = (n) => { try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* storage blocked */ } };
    return powers;
  }).catch((err) => {
    console.error(err);
    flash("Superpowers aren't available on this device");
    powersLoading = null;
    return null;
  });
  return powersLoading;
}

function applyPowerSettings(key) {
  if (!powers) return;
  powers.configure(settings);
  if (key === "power") {
    // start loading the models this power needs while the user reads the hint
    const w = powerWants(settings.power);
    tracker?.warm([...(w.person ? ["person"] : []), ...(w.face ? ["face"] : [])]);
    showStatus(powerById(settings.power).hint);
  }
}

/** "Get started" row of the Powers tab: learn the room (for powers that use it) and the how-to guide. */
function renderPowerStart() {
  const nodes = [];
  if (powerById(settings.power).needs.includes("plate")) {
    const b = el("button", { className: "chip lead" }, "Learn the background");
    b.addEventListener("click", () => {
      powers?.learnBackground();
      flash("Step out of view for 3 seconds while TrackED learns the room. Keep the camera still.");
    });
    nodes.push(b);
  }
  const g = el("button", { className: "chip guide" },
    `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.01"/></svg>How to use your powers`);
  g.addEventListener("click", () => openGuide("powers"));
  nodes.push(g);
  return nodes;
}

const powerLayer = $("#power-layer");
function drawPowersHud(t) {
  const w = stage.clientWidth, h = stage.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
  if (powerLayer.width !== Math.round(w * dpr) || powerLayer.height !== Math.round(h * dpr)) {
    powerLayer.width = Math.round(w * dpr);
    powerLayer.height = Math.round(h * dpr);
  }
  const g = powerLayer.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  powers.drawHud(g, w, h, t);
}

let lessonTick = 0;                    // refresh the rhythm lesson card every 6 frames
const musicLayer = $("#music-layer");
function drawMusic(t) {
  const w = stage.clientWidth, h = stage.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
  if (musicLayer.width !== Math.round(w * dpr) || musicLayer.height !== Math.round(h * dpr)) {
    musicLayer.width = Math.round(w * dpr);
    musicLayer.height = Math.round(h * dpr);
  }
  const g = musicLayer.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  music.draw({ hands: state.hands, t, accent: settings.color, w, h });
}

// ---------------- Presets and lessons ----------------
function applyPreset(pr) {
  Object.assign(settings, pr.set);
  saveSettings();
  applyMusicSettings("instrument");
  renderChips();
  flash(`${pr.label}: play along!`);
}

const STARS_KEY = "tracked.lessonStars";
function bestStars() { try { return JSON.parse(localStorage.getItem(STARS_KEY) || "{}"); } catch { return {}; } }
function saveStars(id, n) {
  const all = bestStars();
  if ((all[id] ?? 0) >= n) return;
  all[id] = n;
  try { localStorage.setItem(STARS_KEY, JSON.stringify(all)); } catch { /* storage blocked */ }
}
const starText = (n) => (n ? " " + "★".repeat(n) + "☆".repeat(3 - n) : "");

/** Learn tab: first steps for the current instrument, songs, rhythms and music basics. */
function renderLessons() {
  const stars = bestStars();
  const chip = (label, onClick, cls = "chip") => { const b = el("button", { className: cls }, label); b.addEventListener("click", onClick); return b; };
  const inst = OPTIONS.instrument.find((o) => o.value === settings.instrument)?.label ?? "";
  const nodes = [chip(`▶ First steps: ${inst}`, () => startLesson("skill"), "chip lead")];
  const prefix = settings.instrument === "harp" ? "harp:" : settings.instrument === "theremin" ? "theremin:" : "";
  for (const song of SONGS) {
    const id = prefix + song.id;
    nodes.push(chip(`🎵 ${song.title}${starText(stars[id])}`, () => startLesson("song", id)));
  }
  for (const r of RHYTHMS) nodes.push(chip(`🥁 ${r.title}${starText(stars[`rhythm:${r.id}`])}`, () => startLesson("rhythm", r.id)));
  for (const id of MUSIC_GUIDE_ORDER) nodes.push(chip(`📖 ${MUSIC_GUIDES[id].title}`, () => openGuide(`music:${id}`)));
  return nodes;
}

function startLesson(kind, id) {
  if (!music) return;
  const want = kind === "skill" ? {} : lessonSettings(kind, id);
  const changed = Object.entries(want).some(([k, v]) => settings[k] !== v);
  Object.assign(settings, want);
  saveSettings();
  if (changed) applyMusicSettings("instrument");
  if (kind === "song") {
    music.startSong(id);
    const secs = music.previewSong(id);            // hear it first
    flash(`Listen first… then play it note by note (${Math.round(secs)} s)`);
  } else if (kind === "rhythm") music.startRhythm(id);
  else music.startSkills();
  renderChips();
}

function renderLesson() {
  const card = $("#lesson");
  const v = music?.lessonView();
  if (!v) { card.hidden = true; return; }
  card.hidden = false;
  card.querySelector("h2").textContent = v.title;
  card.querySelector(".sub").textContent = v.subtitle;
  card.querySelector(".text").textContent = v.text;
  card.querySelector(".bar i").style.width = `${Math.round(v.progress * 100)}%`;
  card.querySelector(".next").replaceChildren(...v.upcoming.map((n, i) => el("span", { className: i === 0 ? "now" : "", textContent: n })));
  card.querySelector(".stars").textContent = v.finished ? "★".repeat(v.stars) + "☆".repeat(3 - v.stars) : "";
  card.classList.toggle("done", v.finished);
  if (v.finished && music.lesson && !music.lesson.saved) {
    music.lesson.saved = true;
    const id = music.lesson.kind === "rhythm" ? `rhythm:${music.lesson.id}` : music.lesson.id;
    saveStars(id, v.stars);
    buzz(30);
    renderChips();
  }
}
$("#lesson .restart").addEventListener("click", () => {
  const L = music?.lesson;
  if (!L) return;
  if (L.kind === "song") music.startSong(L.id);
  else if (L.kind === "rhythm") music.startRhythm(L.id);
  else music.startSkills();
});
$("#lesson .close").addEventListener("click", () => music?.stopLesson());

// ---------------- Face masks ----------------
// Built-in masks are painted in the face's canonical UV space; "Your mask" is an
// image painted on the downloadable template; "Face swap" maps a photo's own face
// mesh onto yours. How much the live lighting shades each mask:
const MASK_SHADE = { wire: 0, visor: 0.3, skull: 0.7, gold: 0.95, feline: 0.7, warpaint: 0.6, kitsune: 0.65, custom: 0.55 };
const COLORED_MASKS = new Set(["wire", "visor", "warpaint", "kitsune"]);
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
  const image = await decodeImage(f, { premultiplyAlpha: "none" });
  if (!image) return;
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
  const glb = OPTIONS.accessory.find((o) => o.value === a)?.glb;
  if (a === "model") {
    if (t.userModel) t.fitUserModel(settings.anchor, Number(settings.size), modelFit);
    else t.setAccessory(null);
  } else if (glb) {
    const slow = setTimeout(() => flash("Loading the model…"), 400);
    try {
      await t.setBuiltinModel(glb, () => settings.accessory === a && three === t);
    } catch (err) {
      console.error(err);
      if (settings.accessory === a) { flash("Couldn't load that model. Check your connection."); t.setAccessory(null); }
    } finally {
      clearTimeout(slow);
    }
  } else {
    t.setAccessory(a, settings.color);
  }
}

let lastModel = null; // kept to rebuild the 3D layer after a GPU reset
async function onModelFile(e) {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f || !renderer) return;
  const problem = checkUpload(f, "model");
  if (problem) { flash(problem); return; }
  const t = await ensureThree();
  if (!t) return;
  flash("Loading your model…");
  try {
    const buf = await f.arrayBuffer();
    const id = modelKey(buf);
    const fit = fitStore.get(id);
    await t.loadModel(buf.slice(0), settings.anchor, Number(settings.size), fit);
    lastModel = buf;
    modelId = id;
    modelFit = fit;
    state.previewUntil = performance.now() + PREVIEW_MS;
    set("accessory", "model");
    flash(isDefaultFit(fit) ? "Model ready. Pick where it sits and fine-tune it below." : "Model ready, with your saved fit.");
  } catch (err) {
    console.error(err);
    flash(f.name.toLowerCase().endsWith(".gltf")
      ? "This .gltf needs separate files. Export a single .glb instead."
      : "Couldn't read that model. Try exporting it again as .glb.");
  }
}

// ---------------- Fine-tune "Your 3D model" (saved per model) ----------------
const PREVIEW_MS = 4000;
const fitStore = new FitStore((() => { try { return localStorage; } catch { return null; } })());
let modelId = null, modelFit = { ...DEFAULT_FIT }, fitSaveTimer = 0;

function renderFitPanel() {
  if (settings.accessory !== "model" || !three?.userModel) return [];
  const fmt = (f, v) => `${f.step < 1 ? v.toFixed(f.step < 0.1 ? 2 : 1) : v}${f.unit}`;
  const nodes = FIT_FIELDS.map((f) => {
    const n = el("label", { className: "fit" },
      `<span>${f.label}<output></output></span><input type="range" min="${f.min}" max="${f.max}" step="${f.step}">`);
    const input = n.querySelector("input"), out = n.querySelector("output");
    input.value = modelFit[f.key];
    out.textContent = fmt(f, modelFit[f.key]);
    input.addEventListener("input", () => {
      modelFit = clampFit({ ...modelFit, [f.key]: Number(input.value) });
      out.textContent = fmt(f, modelFit[f.key]);
      onFitChanged();
    });
    // double-click / double-tap a slider to reset just that value
    input.addEventListener("dblclick", () => {
      modelFit = { ...modelFit, [f.key]: DEFAULT_FIT[f.key] };
      input.value = modelFit[f.key];
      out.textContent = fmt(f, modelFit[f.key]);
      onFitChanged();
    });
    return n;
  });
  const reset = el("button", { className: "chip" }, "Reset fit");
  reset.addEventListener("click", () => { modelFit = { ...DEFAULT_FIT }; onFitChanged(); renderChips(); });
  nodes.push(reset);
  return nodes;
}

function onFitChanged() {
  three?.setUserFit(modelFit);
  state.previewUntil = performance.now() + PREVIEW_MS;
  clearTimeout(fitSaveTimer);
  fitSaveTimer = setTimeout(() => { if (modelId) fitStore.set(modelId, modelFit); }, 300);
}

/** Where masks & 3D show; forced to "always" for a few seconds while fine-tuning a model. */
function maskArea() {
  return settings.accessory === "model" && performance.now() < state.previewUntil ? "always" : settings.maskArea;
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
  e.target.value = "";
  if (!f || !renderer) return;
  const bmp = await decodeImage(f);
  if (!bmp) return;
  state.overlayImage?.close?.();
  state.overlayImage = bmp;       // kept (not closed) to re-upload after a GPU reset
  renderer.setOverlay(bmp);
  set("effect", "image");
}

/**
 * Validates and decodes a user image off the main thread (EXIF orientation
 * applied), downscaled to the GPU's max texture size. Returns null + a toast on failure.
 */
async function decodeImage(file, opts = {}) {
  const problem = checkUpload(file, "image");
  if (problem) { flash(problem); return null; }
  try {
    let bmp = await createImageBitmap(file, { imageOrientation: "from-image", ...opts });
    const max = renderer?.maxTexture || 4096;
    const fit = fitTextureSize(bmp.width, bmp.height, max);
    if (fit.scaled) {
      const small = await createImageBitmap(bmp, { resizeWidth: fit.width, resizeHeight: fit.height, resizeQuality: "high", ...opts });
      bmp.close();
      bmp = small;
    }
    return bmp;
  } catch (err) {
    console.warn("image decode failed:", err);
    flash("Couldn't open that image. Try a PNG or JPG.");
    return null;
  }
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
  const cycleKey = isMusic() ? "instrument" : isPowers() ? "power" : "effect";
  const list = OPTIONS[cycleKey].map((o) => o.value);
  const i = list.indexOf(settings[cycleKey]);
  if (e.key === "ArrowRight") set(cycleKey, list[(i + 1) % list.length]);
  else if (e.key === "ArrowLeft") set(cycleKey, list[(i + list.length - 1) % list.length]);
  else if (e.key === "p" || e.key === "P") $("#photo").click();
  else if (e.key === "r" || e.key === "R") $("#rec").click();
  else if (e.key === "d" || e.key === "D") $("#debug").click();
  else if (e.key === "f" || e.key === "F") toggleFreeze();
  else if (e.key === "m" || e.key === "M") setMode(isMusic() ? "effects" : "music");
  else if (e.key === "s" || e.key === "S") setMode(isPowers() ? "effects" : "powers");
  else if ((e.key === "l" || e.key === "L") && isMusic()) toggleLoop();
  else if (e.key === "?") toggleHelp();
  else if (e.key === "Escape" && !$("#guidePanel").hidden) closeGuide();
  else if (e.key === "Escape" && !$("#helpPanel").hidden) toggleHelp(false);
  else if (e.key === "Escape" && countdownTimer) cancelCountdown();
  else return;
  e.preventDefault();
});

// ---------------- Startup ----------------
async function start() {
  // reopening in music / powers mode: start the audio now, while we are inside the click
  const audioReady = settings.mode !== "effects" ? engine.ensure().catch(() => null) : null;
  $("#start").hidden = true;
  $("#app").hidden = false;
  fitStage();
  // the camera only exists in secure contexts (https / localhost)
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showError({ title: "The camera needs a secure page", hint: "Open TrackED over https:// (or localhost) in a recent browser.", retry: false });
    return;
  }
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    showError({ title: "Your browser can't run the effects", hint: `${err.message}. Try a recent Chrome, Safari, Edge or Firefox.`, retry: false });
    return;
  }
  watchContextLoss();
  capture = new Capture(canvas, (msg) => flash(msg));
  // in music and powers mode, recordings carry the sound
  capture.audioSource = () => ((isMusic() || isPowers()) && engine.ready ? engine.stream : null);
  if (settings.mode === "powers") {
    await audioReady;
    if (await ensurePowers()) { applyPowerSettings("power"); $("#power-layer").hidden = false; }
    else settings.mode = "effects";
  } else if (audioReady && await audioReady) {
    music = new MusicMode(engine, $("#music-layer"));
    music.onLessonChange = renderLesson;
    applyMusicSettings();
    $("#music-layer").hidden = false;
  } else if (settings.mode === "music") {
    settings.mode = "effects";
  }
  applyMask();
  applyAccessory();
  tracker = new HandTracker({ detectWidth: device.detectWidth });
  tracker.onResult = onVision;
  tracker.onStatus = (msg) => (msg ? flash(msg) : null);
  keepAwake();
  // startup checklist: show what is loading and what is ready
  bootStep("camera", "doing");
  bootStep("model", "doing");
  $("#boot").hidden = false;
  const camP = startCamera().then((v) => { bootStep("camera", "done"); return v; }, (e) => { bootStep("camera", "fail"); throw e; });
  const trkP = tracker.init().then((v) => { bootStep("model", "done"); return v; }, (e) => { bootStep("model", "fail"); throw e; });
  // camera and model load in parallel; each failure gets its own message
  const [cam, trk] = await Promise.allSettled([camP, trkP]);
  setTimeout(() => { $("#boot").hidden = true; }, 600);
  if (trk.status === "fulfilled") state.trackerMode = trk.value;
  if (cam.status === "rejected") return; // startCamera showed the error panel; its retry restarts the loop
  if (trk.status === "rejected") {
    console.error(trk.reason);
    showError({ title: "Couldn't load hand tracking", hint: "Check your internet connection (the models download on first use), then try again.", retry: true, onRetry: () => location.reload() });
    return;
  }
  showStatus(MSG.showBoth);
  scheduleFrame();
  maybeStartTutorial();
  // warm up the face model while idle, so the first mask / face filter / 3D accessory is instant
  if (device.tier !== "low") (window.requestIdleCallback || setTimeout)(() => tracker.warm(["face"]), { timeout: 4000 });
}

/**
 * Starts the camera, stepping down a ladder of constraints when the device
 * can't satisfy them (OverconstrainedError, busy camera, no rear camera…).
 * Shows the error panel and rethrows when it finally fails.
 */
async function startCamera() {
  video.srcObject?.getTracks().forEach((t) => t.stop());
  // portrait screens (phones) ask for a portrait stream so the camera fills the screen
  const short = device.cameraHeight, long = Math.round((short * 16) / 9);
  const portrait = innerHeight > innerWidth;
  const ladder = constraintLadder({ facing: state.facing, width: portrait ? short : long, height: portrait ? long : short });
  let stream, lastErr;
  for (const video of ladder) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      break;
    } catch (err) {
      lastErr = err;
      if (!describeCameraError(err).relax) break;   // e.g. permission denied: simpler constraints won't help
    }
  }
  if (!stream) {
    const d = describeCameraError(lastErr);
    showError({ ...d, onRetry: retryCamera });
    throw lastErr;
  }
  const track = stream.getVideoTracks()[0];
  // camera unplugged, taken by another app, or permission revoked mid-session
  track?.addEventListener("ended", () => {
    if (video.srcObject !== stream) return;
    showError({ title: "The camera stopped", hint: "It was disconnected or another app took it.", retry: true, onRetry: retryCamera });
  });
  video.srcObject = stream;
  try {
    await video.play();
  } catch (err) {
    // autoplay policies can block play() until a user gesture
    if (err?.name === "NotAllowedError") {
      showError({ title: "Tap to start the video", hint: "", retry: true, retryLabel: "Start", onRetry: () => video.play().then(hideError) });
    } else throw err;
  }
  fitStage();
  quadFilter.reset();
  state.quad = null;
  state.faces = [];
  return stream;
}

// ---------------- Onboarding: startup checklist, tutorial, hints, help ----------------
function bootStep(id, status) {
  const li = $(`#boot [data-step="${id}"]`);
  if (li) li.className = status;
}

const onboard = { effectChanges: 0, signsFired: 0, frameShownFor: 0, noHandsFor: 0, oneHandFor: 0, lastT: 0, hintShown: {}, brightness: null };
const tutorial = new Tutorial();
const ART = {
  // neutral line-art hands (original drawings), animated with CSS
  hands: `<svg viewBox="0 0 84 84"><g class="hand-l"><path d="M18 64V40m0 0V26m0 14l-5-9m5 9l6-12m-6 12l1-15m5 3v13"/><path d="M12 64h14"/></g>
          <g class="hand-l r"><path d="M66 64V40m0 0V26m0 14l5-9m-5 9l-6-12m6 12l-1-15m-5 3v13"/><path d="M58 64h14"/></g></svg>`,
  frame: `<svg viewBox="0 0 84 84"><g class="hand-l"><path d="M16 22v34h18"/></g><g class="hand-l r"><path d="M68 62V28H50"/></g>
          <rect class="frame-pulse" x="22" y="28" width="40" height="28" rx="2"/></svg>`,
  pinch: `<svg viewBox="0 0 84 84"><g class="pinch-l"><path d="M14 24v34h16"/></g><g class="pinch-r"><path d="M70 60V26H54"/></g>
          <path d="M36 70l6 6 6-6" opacity=".7"/></svg>`,
  signs: `<svg viewBox="0 0 84 84"><path d="M30 60V40l8-14c2-3 6-2 6 2l-2 10h12c3 0 5 3 4 6l-4 14c-1 2-3 3-5 3H30zM22 40h8v22h-8z"/></svg>`,
  done: `<svg viewBox="0 0 84 84"><path d="M22 44l14 13 26-30"/></svg>`,
};

function maybeStartTutorial(force = false) {
  let seen = false;
  try { seen = localStorage.getItem("tracked.tutorialDone") === "1"; } catch { /* storage blocked */ }
  if (seen && !force) return;
  onboard.effectChanges = onboard.signsFired = onboard.frameShownFor = 0;
  tutorial.start();
  renderCoach(false);
}

function endTutorial() {
  tutorial.stop();
  $("#coach").hidden = true;
  try { localStorage.setItem("tracked.tutorialDone", "1"); } catch { /* storage blocked */ }
}

function renderCoach(celebrating) {
  const coach = $("#coach");
  if (!tutorial.active) { coach.hidden = true; return; }
  const step = tutorial.step;
  coach.hidden = false;
  coach.classList.toggle("success", celebrating);
  coach.querySelector(".art").innerHTML = celebrating ? ART.done : ART[step.art];
  coach.querySelector(".count").textContent = `Step ${tutorial.index + 1} of ${STEPS.length}`;
  coach.querySelector("h2").textContent = celebrating ? "Nice!" : step.title;
  coach.querySelector(".text").textContent = celebrating ? "Let's keep going." : step.text;
  const next = coach.querySelector(".next");
  // required steps unlock "Next" only once done (learn by doing); the optional last step can be finished anytime
  next.textContent = tutorial.index === STEPS.length - 1 ? "Finish" : "Next";
  next.hidden = !step.optional;
}
$("#coach .skip").addEventListener("click", endTutorial);
$("#coach .next").addEventListener("click", () => { tutorial.next(); if (tutorial.finished) endTutorial(); else renderCoach(false); });

// brightness of the camera image, sampled from a tiny canvas once in a while
const probe = Object.assign(document.createElement("canvas"), { width: 24, height: 14 });
const probeCtx = probe.getContext("2d", { willReadFrequently: true });
let lastProbe = 0;
function sampleBrightness(t) {
  if (t - lastProbe < 1.5 || !video.videoWidth) return;
  lastProbe = t;
  probeCtx.drawImage(video, 0, 0, probe.width, probe.height);
  const d = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  onboard.brightness = sum / (d.length / 4) / 255;
}

let hintTimer;
function updateOnboarding(t) {
  const dt = Math.min(0.2, t - (onboard.lastT || t));
  onboard.lastT = t;
  const n = state.hands.length;
  onboard.frameShownFor = state.quad && state.alpha > 0.9 ? onboard.frameShownFor + dt : 0;
  onboard.noHandsFor = n === 0 ? onboard.noHandsFor + dt : 0;
  onboard.oneHandFor = n === 1 ? onboard.oneHandFor + dt : 0;

  if (tutorial.active) {
    const r = tutorial.update({ hands: n, frameShownFor: onboard.frameShownFor, effectChanges: onboard.effectChanges, signsFired: onboard.signsFired }, t);
    if (r.changed) {
      if (tutorial.finished) endTutorial();
      else renderCoach(r.celebrating);
    }
    return; // no extra hints during the tutorial
  }
  sampleBrightness(t);
  // a frame wider than ~90% of the picture usually means the hands are too close
  const q = state.quad;
  const handsTooClose = !!q && Math.max(...q.map((p) => p.x)) - Math.min(...q.map((p) => p.x)) > 0.92;
  const id = $("#hint").hidden ? pickHint({ ...onboard, handsTooClose }, onboard.hintShown, t) : null;
  if (id) {
    onboard.hintShown[id] = t;
    $("#hint span").textContent = HINTS[id];
    $("#hint").hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { $("#hint").hidden = true; }, 5000);
  }
}

// "make your own" guides (src/guides.js)
let guideReturn = null; // element to focus again when the guide closes
function openGuide(id, from = document.activeElement) {
  const g = id === "powers" ? POWER_GUIDE : GUIDES[id] ?? MUSIC_GUIDES[String(id).replace(/^music:/, "")];
  if (!g) return;
  toggleHelp(false);
  const list = (tag, items) => (items?.length ? `<${tag}>${items.map((t) => `<li>${t}</li>`).join("")}</${tag}>` : "");
  const body = $("#guidePanel .body");
  body.innerHTML = `<p class="intro">${g.intro}</p>` + g.sections.map((s) =>
    `<section><h3>${s.heading}</h3>${list("ol", s.steps)}${list("ul", s.tips)}</section>`).join("");
  const actions = el("div", { className: "actions" });
  if (id === "mask") {
    const tpl = el("button", { className: "chip" }, "Download mask template");
    tpl.addEventListener("click", downloadTemplate);
    actions.append(tpl);
  }
  if (id === "3d") actions.append(el("a", { className: "chip", href: "assets/reference/tracked-reference-head.blend", download: "" }, "Download Blender head"));
  if (actions.childElementCount) body.append(actions);
  $("#guideTitle").textContent = g.title;
  $("#guidePanel").hidden = false;
  $("#guidePanel").scrollTop = 0;
  guideReturn = from;
  $("#guidePanel .close").focus();
}
function closeGuide() {
  if ($("#guidePanel").hidden) return;
  $("#guidePanel").hidden = true;
  guideReturn?.focus?.();
}
$("#guidePanel .close").addEventListener("click", closeGuide);
$("#helpPanel .guide-links").append(...Object.entries(GUIDES).map(([id, g]) => {
  const b = el("button", { className: "chip", textContent: g.link });
  b.addEventListener("click", () => openGuide(id, $("#help")));
  return b;
}));

// help panel
function toggleHelp(open = $("#helpPanel").hidden) {
  $("#helpPanel").hidden = !open;
  if (open) $("#helpPanel .close").focus();
}
$("#help").addEventListener("click", () => toggleHelp());
$("#helpPanel .close").addEventListener("click", () => toggleHelp(false));
$("#replay").addEventListener("click", () => { toggleHelp(false); maybeStartTutorial(true); });

/** Retry button for camera errors: restart the camera and (re)start the frame loop. */
async function retryCamera() {
  try {
    await startCamera();
    hideError();
    if (state.trackerMode) {
      showStatus(MSG.showBoth);
      if (!scheduled) scheduleFrame();
    }
  } catch { /* startCamera showed the error again */ }
}

// ---------------- Error panel ----------------
function showError({ title, hint = "", retry = true, retryLabel = "Try again", onRetry = () => location.reload() }) {
  const panel = $("#error");
  panel.querySelector("h2").textContent = title;
  panel.querySelector("p").textContent = hint;
  const btn = panel.querySelector("button");
  btn.hidden = !retry;
  btn.textContent = retryLabel;
  btn.onclick = () => { btn.disabled = true; Promise.resolve(onRetry()).finally(() => { btn.disabled = false; }); };
  panel.hidden = false;
  showStatus("");
}
function hideError() { $("#error").hidden = true; }

// ---------------- WebGL context loss (GPU reset, driver update, too many tabs…) ----------------
// Per the Khronos guidance: preventDefault() on "lost" to be allowed a restore,
// pause rendering, then rebuild every GPU resource on "restored".
let glLost = false;
function watchContextLoss() {
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    glLost = true;
    showStatus("Graphics were reset, recovering…");
  });
  canvas.addEventListener("webglcontextrestored", async () => {
    try {
      renderer = new Renderer(canvas);
      if (state.overlayImage) renderer.setOverlay(state.overlayImage);
      applyMask();
      powers?.rebuild(renderer);
      $("#freeze").classList.remove("on");
      if (three) { const buf = lastModel; three = null; threeLoading = null; if (settings.accessory !== "none") await applyAccessory(); if (buf && settings.accessory === "model") await (await ensureThree())?.loadModel(buf.slice(0), settings.anchor, Number(settings.size), modelFit); }
      glLost = false;
      showStatus("");
    } catch (err) {
      console.error(err);
      showError({ title: "Graphics couldn't recover", hint: "Reload the page to continue." });
    }
  });
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

let scheduled = false;
function scheduleFrame() {
  scheduled = true;
  if (hasRVFC) video.requestVideoFrameCallback(onFrame);
  else requestAnimationFrame(onFrame);
}

// One failing frame must not kill the loop, but a loop failing on every frame
// must stop spinning and tell the user.
const frameFailures = new FailureBudget(60);
function onFrame() {
  scheduleFrame();
  if (glLost) return;
  if (!hasRVFC) {
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
  }
  try {
    renderFrame();
    frameFailures.ok();
  } catch (err) {
    console.error("frame failed:", err);
    if (frameFailures.fail()) {
      glLost = true; // stop rendering
      showError({ title: "Something went wrong", hint: String(err?.message || err), retryLabel: "Reload" });
    }
  }
}

function renderFrame() {
  const t = performance.now();
  // power saving: with no hand in sight for 3 s, track every other frame (a hand
  // entering the picture is still picked up within ~70 ms)
  const idle = t - state.handsSeenAt > 3000 && !isPowers() && !(maskArea() === "always" && (settings.mask !== "none" || settings.accessory !== "none"));
  if (!idle || (state.idleTick = !state.idleTick)) tracker.submit(video, t, extrasWanted());
  update(t / 1000);
  if (isPowers() && powers) {
    // superpowers: their own GPU passes, then a small 2D HUD on top
    powers.render(video, t / 1000, { mirror: state.facing === "user" });
    drawPowersHud(t / 1000);
    capture.afterDraw();
    if (state.debug) drawDebug();
    countFps(t);
    return;
  }
  const fs = frameState(t / 1000);
  if (isMusic() && music) {
    // music mode: plain video, the instrument is drawn on its own layer
    renderer.draw(video, { ...fs, quad: null, alpha: 0, faces: [] });
    music.tick(t / 1000);              // loop playback; gestures are handled in onVision
    if (music.lesson?.kind === "rhythm" && !music.lesson.finished && ++lessonTick % 6 === 0) renderLesson();
    drawMusic(t / 1000);
    capture.afterDraw();
    if (state.debug) drawDebug();
    countFps(t);
    return;
  }
  renderer.draw(video, fs);
  const area = maskArea();
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
  updateOnboarding(t / 1000);
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
  if (isMusic()) return {};
  if (isPowers()) {
    const w = powers?.wants() ?? {};
    if (!w.person && !w.face) return {};
    state.frameNo++;
    // the body mask drives most powers: run it as often as the device allows
    const every = w.person ? Math.max(1, extrasEvery - 1) : extrasEvery;
    if (state.frameNo % every) return {};
    return { person: !!w.person, face: !!w.face };
  }
  const mesh = settings.mask !== "none" && (settings.mask !== "custom" && settings.mask !== "swap" || !!userMasks[settings.mask]);
  const pose = settings.accessory !== "none" && !!three?.active;
  const maskAlways = (mesh || pose) && maskArea() === "always";
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
  if (isPowers()) {
    if (state.hands.length) state.handsSeenAt = now;
    if (powers) {
      if (result.person) powers.setPerson(result.person);
      if (result.faces) powers.setFaces(state.faces);
      showStatus(powers.update(state.hands, now / 1000, aspect));
    }
    return;
  }
  if (isMusic()) {
    // the hands play the instrument: no frame, pinch-to-switch or signs.
    // Notes are triggered right here, as soon as the landmarks arrive (lowest latency).
    if (state.hands.length) state.handsSeenAt = now;
    if (music) showStatus(music.update(state.hands, now / 1000, aspect));
    return;
  }
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
  if (r.fire) { sgn.run(); buzz(18); onboard.signsFired++; }
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
  const area = maskArea();
  state.faces.forEach((f, i) => {
    const target = area !== "face" || (frameOn && faceInFrame(f, state.quad)) ? 1 : 0;
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
  if (document.hidden) {
    video.pause();
    music?.release();
    powers?.sfx.stopAll();
    engine.suspend();
    if (capture?.recorder) toggleRecording(); // save the clip instead of recording a frozen frame
  }
  else { video.play().catch(() => {}); keepAwake(); if (isMusic() || isPowers()) engine.ensure().catch(() => {}); }
});

// Last-resort error reporting: log everything, tell the user at most every 5 s.
let lastErrorToast = 0;
function reportGlobal(err) {
  console.error(err);
  const now = performance.now();
  if (now - lastErrorToast < 5000 || !$("#app") || $("#app").hidden) return;
  lastErrorToast = now;
  flash("Something went wrong, but TrackED keeps running.");
}
addEventListener("error", (e) => reportGlobal(e.error || e.message));
addEventListener("unhandledrejection", (e) => reportGlobal(e.reason));

// Cache models / WASM / libraries for instant second launches and offline use.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((err) => console.warn("service worker:", err)));
}

// test hook (used by automated browser tests only)
window.__tracked = { state, settings, set, get modelFit() { return modelFit; }, onVision: (...a) => onVision(...a), get renderer() { return renderer; }, get three() { return three; }, get tracker() { return tracker; }, get music() { return music; }, get powers() { return powers; }, engine, setMode: (m) => setMode(m) };
