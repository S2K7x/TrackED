// Superpower mode controller: the shared engine under the powers.
//
//   hands / face / body mask → the selected ability (abilities.js) → GPU passes,
//   particles, lights, sounds and a small HUD.
//
// Timing (same split as the music mode):
//  - gestures are read in update(), called on EVERY tracking result
//  - simulation and drawing run in render(), once per camera frame
// Everything visual is drawn on the main WebGL canvas, so photos and videos
// include it; only the HUD (hold rings, charge, score, title card) is on a 2D layer.

import { powerById, powerWants, POWER_IDS } from "./catalog.js";
import { HandTracks, Trigger, maskStats } from "./gestures.js";
import { SignHold, classifySign } from "../gestures.js";
import { Particles, GlowBatch, KIND, FIRE, WHITE, mixColor } from "./particles.js";
import { Targets } from "./targets.js";
import { PowerRenderer } from "./fx-gl.js";
import { PowerSfx } from "./sfx.js";
import { ABILITIES } from "./abilities.js";
import { hexToRgb } from "../options.js";

const INTENSITY = { subtle: 0.55, strong: 1, epic: 1.7 };
const MAX_LIGHTS = 8, MAX_HEAT = 6, MAX_SCORCH = 12;
const SCORCH_GLOW = 1.5, SCORCH_LIFE = 7;      // seconds glowing, seconds before the soot is gone
const rand = (a, b) => a + Math.random() * (b - a);

export class PowersMode {
  /**
   * @param {{renderer: import("../renderer.js").Renderer, engine: import("../music/audio.js").AudioEngine, overlay: HTMLCanvasElement}} o
   */
  constructor({ renderer, engine, overlay }) {
    this.gfx = new PowerRenderer(renderer);
    this.sfx = new PowerSfx(engine);
    this.overlay = overlay;
    this.particles = new Particles(4000);
    this.B = new GlowBatch(7000);
    this.handTracks = new HandTracks();
    this.switchHold = new SignHold(0.8);
    this.targets = new Targets();
    this.s = {};
    this.faces = [];
    this.facesAt = -10;
    this.body = null;
    this.aspect = 16 / 9;
    this.mirror = true;
    this.color = [1, 0.18, 0.33];
    this.hot = mixColor(this.color, WHITE, 0.55);
    this.newMask = false;
    this.frame = 0;
    this.t = 0;
    this.bestSaved = 0;        // best training score (restored and saved by the app)
    this.onBest = null;
    this.onMoment = null;      // (name) => void: haptics, "snap big moments"
    this.onNextPower = null;   // 👍 held: hands-free switch
    this.lastUpdate = 0;
    this.lastRender = 0;
    this.ability = null;
    this.#clear();
  }

  #clear() {
    this.waves = [];
    this.flares = [];
    this.scorches = [];
    this.lights = [];
    this.heats = [];
    this.flashV = 0;
    this.shakeAmp = 0;
    this.aberrV = 0;
    this.vig = 0;
    this.holdUI = null;
    this.freezeWanted = false;
    this.triggers = new Map();
    this.particles.clear();
    this.handTracks.reset();
    this.switchHold.reset();
  }

  get power() { return this.s.power; }
  get always() { return this.s.activation === "always"; }
  get k() { return INTENSITY[this.s.intensity] ?? 1; }
  get training() { return this.s.training === "on"; }
  get tracks() { return this.handTracks.tracks; }
  get targetsList() { return this.training ? this.targets.list : []; }
  get facesFresh() { return this.t - this.facesAt < 0.6; }

  /** @param {object} s  all settings (the power keys are read) */
  configure(s) {
    const changed = s.power !== this.s.power;
    const wasAlways = this.s.activation === "always";
    const wasTraining = this.s.training === "on";
    this.s = { ...s };
    this.color = hexToRgb(s.color || "#ff2d55");
    this.hot = mixColor(this.color, WHITE, 0.55);
    this.sfx.enabled = s.powerSound !== "off";
    if (!this.sfx.enabled) this.sfx.stopAll();
    if (changed) this.#select(s.power);
    if (this.training && !wasTraining) this.targets.startRound(this.t);
    if (!this.training) this.targets.reset();
    if (this.always !== wasAlways && !changed) this.ability?.setOn?.(this, this.always);
  }

  #select(id) {
    this.ability?.stop?.();
    this.sfx.stopAll();
    this.#clear();
    this.gfx.clearHistory();
    this.ability = (ABILITIES[id] ?? ABILITIES.wave)();
    this.title = { id, t: this.t || this.lastRender };
  }

  /** Stops every effect and forgets gesture state (mode change). */
  release() {
    this.ability?.stop?.();
    this.sfx.stopAll();
    if (this.s.power) this.ability = ABILITIES[this.s.power]();
    this.#clear();
    this.gfx.clearHistory();
  }

  /** Page hidden: stop every sound (continuous ones restart by themselves when needed). */
  silence() {
    this.ability?.stop?.();
    this.sfx.stopAll();
  }

  deactivate() {
    this.release();
    this.targets.reset();
    this.overlay.getContext("2d").clearRect(0, 0, 1e5, 1e5);
  }

  /** Rebuilds the GPU side after a WebGL context loss. */
  rebuild(renderer) {
    this.gfx = new PowerRenderer(renderer);
    if (this.ability?.st?.on && this.power === "freeze") this.freezeWanted = true;
  }

  /** Extra models this power needs from the tracker. */
  wants() { return powerWants(this.power); }

  /** True while something is visibly going on (the app keeps tracking at full rate). */
  get busy() { return this.always || !!this.ability?.st?.on || this.waves.length > 0 || this.particles.n > 0; }

  /** Forgets the learned room (the camera moved, or the user asked). */
  learnBackground() { this.gfx.resetPlate(); }

  /** Fresh soft person mask (camera space). */
  setPerson(mask) {
    this.gfx.setPerson(mask);
    this.body = maskStats(mask, this.mirror);
    this.newMask = true;
  }

  /** Face anchors in display space (laser vision). */
  setFaces(faces) { this.faces = faces; this.facesAt = this.lastUpdate; }

  // ---------------- helpers for the abilities ----------------
  /** A Trigger per (kind, hand), forgotten when the hand leaves. */
  trig(kind, tr, cooldown) {
    const key = `${kind}:${tr.id}`;
    if (!this.triggers.has(key)) this.triggers.set(key, new Trigger(cooldown));
    return this.triggers.get(key);
  }

  burst(x, y, n, { color = WHITE, color1, speed = 0.5, size = 0.01, life = 0.6, kind = KIND.DOT, grav = 0, drag = 1.5 } = {}) {
    for (let i = 0, count = Math.round(n * this.k); i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
      this.particles.emit({ x, y, vx: (Math.cos(a) * v) / this.aspect, vy: Math.sin(a) * v, life: life * rand(0.6, 1.2), size: size * rand(0.6, 1.3), size1: size * 0.3, color, color1: color1 ?? color, grav, drag, kind });
    }
  }

  /** Shockwave: a ring distortion that expands from (x, y). speed in heights / s. */
  wave(x, y, speed = 1.2, strength = 1) {
    this.waves.push({ x, y, t0: this.t, speed, strength, life: 0.9 });
    if (this.waves.length > 4) this.waves.shift();
  }

  /** Light falling on the room this frame. r = reach (height units), s = intensity. */
  light(x, y, r, s, color) { if (s > 0.01) this.lights.push({ x, y, r, s, color }); }
  /** A light that fades out by itself over `life` seconds (explosions, strikes). */
  flare(x, y, r, s, color, life = 0.4) { this.flares.push({ x, y, r, s, color, t0: this.t, life }); }
  /** Rising heat haze above a hot spot this frame. */
  heat(x, y, r, s) { if (this.heats.length < MAX_HEAT * 2) this.heats.push({ x, y, r, s }); }
  /** A scorch mark: glowing embers that cool down to soot, then fade. */
  scorch(x, y, r) {
    this.scorches.push({ x, y, r: r * (0.8 + 0.4 * Math.random()), t0: this.t });
    if (this.scorches.length > MAX_SCORCH) this.scorches.shift();
  }
  shake(a) { this.shakeAmp = Math.max(this.shakeAmp, a); }
  flash(v) { this.flashV = Math.max(this.flashV, v); }
  aberr(v) { this.aberrV = Math.max(this.aberrV, v); }
  vignette(v) { this.vig = Math.max(this.vig, v); }
  requestFreeze() { this.freezeWanted = true; }
  moment(name) { this.onMoment?.(name); }

  explode(x, y, size = 1) {
    this.burst(x, y, 50 * size, { color: FIRE.core, color1: FIRE.edge, speed: 0.7 * size, size: 0.02 * size, life: 0.8, grav: -0.3, drag: 2.5, kind: KIND.FLAME });
    this.burst(x, y, 25 * size, { color: FIRE.mid, speed: 1.1 * size, size: 0.005, life: 0.6, kind: KIND.SPARK, grav: 1.5 });
    this.wave(x, y, 1.4, 0.9 * size);
    this.flare(x, y, 0.45 * size, 2.2 * size, [1, 0.55, 0.2], 0.6);
    this.scorch(x, y, 0.05 * size);
    this.sfx.boom(size);
    this.shake(0.01 * size);
    this.flash(0.15 * size);
    this.aberr(0.02 * size);
    this.hitCircle(x, y, 0.08 * size);
    this.moment("explosion");
  }

  // training hit tests (no-ops when training is off)
  hitCircle(x, y, r) { return this.training ? this.#hits(this.targets.hitCircle(x, y, r, this.t, this.aspect)) : []; }
  hitSegment(ax, ay, bx, by, w) { return this.training ? this.#hits(this.targets.hitSegment(ax, ay, bx, by, w, this.t, this.aspect)) : []; }
  hitRing(x, y, r, w) { return this.training ? this.#hits(this.targets.hitRing(x, y, r, w, this.t, this.aspect)) : []; }

  #hits(hits) {
    for (const g of hits) {
      this.sfx.hit(this.targets.combo);
      this.burst(g.x, g.y, 30, { color: mixColor(g.gold ? [1, 0.8, 0.2] : this.color, WHITE, 0.4), speed: 0.6, size: 0.006, life: 0.6, kind: KIND.SPARK, grav: 0.8 });
      this.burst(g.x, g.y, 12, { color: g.gold ? [1, 0.75, 0.2] : this.color, speed: 0.2, size: 0.03, life: 0.5 });
      this.flare(g.x, g.y, 0.15, 1, g.gold ? [1, 0.8, 0.3] : this.color, 0.3);
      this.hitText = { x: g.x, y: g.y, text: `+${g.points}`, t: this.t, combo: this.targets.combo };
    }
    if (hits.length && this.targets.best > this.bestSaved) { this.bestSaved = this.targets.best; this.onBest?.(this.bestSaved); }
    return hits;
  }

  /** Nearest training target within ~35° of a pointing direction (bolts home in). */
  aimAt(from, dir) {
    let best = null, bestCos = Math.cos(0.6);
    const dl = Math.hypot(dir.x * this.aspect, dir.y);
    for (const g of this.targetsList) {
      const vx = (g.x - from.x) * this.aspect, vy = g.y - from.y, vl = Math.hypot(vx, vy);
      const cos = (vx * dir.x * this.aspect + vy * dir.y) / (vl * dl || 1);
      if (cos > bestCos) { bestCos = cos; best = { x: g.x, y: g.y }; }
    }
    return best;
  }

  // ---------------- gestures (every tracking result) ----------------
  /**
   * @param {object[][]} hands  landmarks, display space
   * @returns {string} status line
   */
  update(hands, t, aspect = 16 / 9) {
    const dt = this.lastUpdate ? Math.min(0.2, t - this.lastUpdate) : 0;
    this.lastUpdate = this.t = t;
    this.aspect = aspect;
    const tracks = this.handTracks.update(hands, t, aspect);
    const live = new Set(tracks.map((x) => `:${x.id}`));
    for (const key of this.triggers.keys()) if (!live.has(key.slice(key.indexOf(":")))) this.triggers.delete(key);
    this.holdUI = null;
    // hands-free switch: hold 👍 with one hand
    if (this.s.powerSwitch !== "off") {
      const sign = hands.length === 1 ? classifySign(hands[0], aspect) : null;
      const r = this.switchHold.update(sign === "thumbs_up" ? "next" : null, t);
      if (r.sign && tracks[0]) this.holdUI = { x: tracks[0].info.palm.x, y: tracks[0].info.palm.y, p: r.progress, label: "Next power" };
      if (r.fire) { this.onNextPower?.(); return powerById(this.power).hint; }
    }
    this.ability?.gesture?.(this, dt);
    return this.#status(hands);
  }

  #status(hands) {
    const p = powerById(this.power);
    if (p.needs.includes("person") && !this.gfx.hasMask) return "Loading body tracking…";
    if ((this.power === "size" || this.power === "teleport") && !this.body) return "Step into the picture so TrackED can see you";
    if (this.power === "eyes" && !this.faces.length) return "Face the camera";
    if (!hands.length && this.power !== "eyes" && !p.toggle) return "Show your hands";
    return p.hint;
  }

  // ---------------- simulation + drawing (every frame) ----------------
  /**
   * @param {HTMLVideoElement} video
   * @param {number} t  seconds
   * @param {{mirror: boolean}} o
   */
  render(video, t, { mirror }) {
    const dt = this.lastRender ? Math.min(0.05, t - this.lastRender) : 0;
    this.lastRender = this.t = t;
    this.mirror = mirror;
    if (!this.gfx.begin(video)) return;
    this.frame++;
    this.B.reset();
    this.lights = [];
    this.heats = [];
    this.vig = 0;
    this.world = { wells: [], drags: [], portals: [], frostPts: [], invis: 0, frozen: 0, echo: 0, clones: 0, cloneAmt: 0, aura: 0, frost: 0, move: null };
    // hands that haven't been seen for a while don't emit anything
    if (t - this.lastUpdate > 0.4 && this.tracks.length) this.handTracks.reset();

    this.ability?.frame?.(this, dt);

    // ---- shockwaves ----
    this.waves = this.waves.filter((w) => t - w.t0 < w.life);
    const waves = this.waves.map((w) => {
      const age = t - w.t0, r = w.speed * age, s = w.strength * (1 - age / w.life);
      this.B.push(w.x, w.y, w.x, w.y, mixColor(this.color, WHITE, 0.6), s * 0.5, r, KIND.RING, 0.01, w.t0);
      this.hitRing(w.x, w.y, r, 0.03);
      return { x: w.x, y: w.y, r, s };
    });

    // ---- training ----
    if (this.training) {
      this.targets.update(dt, t);
      for (const g of this.targets.list) {
        const pulse = 1 + 0.08 * Math.sin(t * 5 + g.id);
        const c = g.gold ? [1, 0.8, 0.25] : [1, 0.85, 0.3];
        this.B.push(g.x, g.y, g.x, g.y, c, 0.9, g.r * pulse, KIND.RING, g.gold ? 0.008 : 0.005, g.id);
        this.B.push(g.x, g.y, g.x, g.y, g.gold ? [1, 0.7, 0.1] : [1, 0.6, 0.2], 0.5, g.r * 0.35, KIND.DOT);
        if (g.gold) this.light(g.x, g.y, 0.1, 0.4, [1, 0.8, 0.3]);
      }
      if (this.targets.over && !this.roundSaved) { this.roundSaved = true; this.sfx.fanfare(); }
      if (!this.targets.over) this.roundSaved = false;
    }

    this.particles.update(dt);
    this.particles.write(this.B);

    // ---- lights: this frame's + fading flares, the strongest 8 ----
    this.flares = this.flares.filter((f) => t - f.t0 < f.life);
    for (const f of this.flares) { const k = 1 - (t - f.t0) / f.life; this.light(f.x, f.y, f.r, f.s * k * k, f.color); }
    const lights = this.lights.length > MAX_LIGHTS ? this.lights.sort((a, b) => b.s - a.s).slice(0, MAX_LIGHTS) : this.lights;
    const heat = this.heats.length > MAX_HEAT ? this.heats.sort((a, b) => b.s - a.s).slice(0, MAX_HEAT) : this.heats;
    // scorch: heat packed as 1 + glow (glowing) or 0..1 (soot fading out)
    this.scorches = this.scorches.filter((s) => t - s.t0 < SCORCH_LIFE);
    const scorch = this.scorches.map((s) => {
      const age = t - s.t0;
      return { x: s.x, y: s.y, r: s.r, s: age < SCORCH_GLOW ? 2 - age / SCORCH_GLOW : 1 - (age - SCORCH_GLOW) / (SCORCH_LIFE - SCORCH_GLOW) };
    });

    // ---- camera: shake, flash, aberration decay ----
    this.shakeAmp *= Math.exp(-6 * dt);
    this.flashV *= Math.exp(-7 * dt);
    this.aberrV *= Math.exp(-5 * dt);
    const amp = this.s.shake === "off" ? 0 : this.shakeAmp;
    const shake = { x: rand(-amp, amp), y: rand(-amp, amp) };

    // ---- GPU ----
    const needs = powerById(this.power).needs;
    if (this.newMask && needs.includes("plate")) this.gfx.updatePlate();
    this.newMask = false;
    if (needs.includes("history") && this.frame % 2 === 0) this.gfx.pushHistory();
    if (this.freezeWanted) { this.gfx.captureFreeze(); this.freezeWanted = false; }
    const W = this.world;
    this.gfx.drawWorld({
      mirror, time: t, aspect: this.aspect, color: this.color, shake,
      invis: W.invis, cloak: { clear: 0, shimmer: 1, ghost: 2 }[this.s.cloak] ?? 1,
      frozen: W.frozen, echo: W.echo, clones: W.clones, cloneAmt: W.cloneAmt, aura: W.aura,
      waves, wells: W.wells, drags: W.drags, portals: W.portals, heat, lights, scorch,
      frost: W.frost, frostPts: W.frostPts, move: W.move,
      flash: Math.min(0.85, this.flashV), aberr: this.s.shake === "off" ? 0 : Math.min(0.05, this.aberrV),
      vignette: Math.min(0.5, this.vig), cinema: this.s.look === "cinema" ? 1 : 0,
    });
    this.gfx.drawGlow(this.B, { aspect: this.aspect, time: t, shake, glow: 0.6 + 0.4 * this.k });
  }

  // ---------------- HUD (2D layer, not recorded) ----------------
  drawHud(g, w, h, t) {
    g.clearRect(0, 0, w, h);
    const X = (x) => x * w, Y = (y) => y * h;
    const fs = Math.max(12, Math.round(h * 0.024));
    const font = (weight, size) => `${weight} ${Math.round(size)}px Urbanist, system-ui, sans-serif`;
    g.font = font(600, fs);
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (this.holdUI) {
      const { x, y, p, label } = this.holdUI, r = 34;
      g.lineWidth = 5;
      g.strokeStyle = "rgba(255,255,255,.3)";
      g.beginPath(); g.arc(X(x), Y(y), r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = "#d4ff3a";
      g.beginPath(); g.arc(X(x), Y(y), r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); g.stroke();
      g.fillStyle = "#fff";
      g.fillText(label, X(x), Y(y) - r - 14);
    }
    this.ability?.hud?.(g, X, Y, this);

    // title card when a power is picked: icon, name
    const tc = this.title;
    if (tc && t - tc.t < 2.2) {
      const p = powerById(tc.id), k = (t - tc.t) / 2.2;
      g.globalAlpha = Math.min(1, k * 8, (1 - k) * 4);
      const s = 1 + 0.06 * (1 - Math.min(1, k * 4));
      g.font = font(700, fs * 2.6 * s);
      g.fillStyle = "#fff";
      g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 18;
      g.fillText(`${p.icon} ${p.label}`, X(0.5), Y(0.42));
      g.font = font(500, fs * 1.05);
      g.fillText(`${POWER_IDS.indexOf(tc.id) + 1} / ${POWER_IDS.length}`, X(0.5), Y(0.42) + fs * 2.4);
      g.shadowBlur = 0;
      g.globalAlpha = 1;
      g.font = font(600, fs);
    }

    if (this.training) {
      const T = this.targets;
      const left = T.timeLeft(t);
      const text = T.over
        ? `Round over · ${T.score} points${T.score >= Math.max(T.best, this.bestSaved) && T.score > 0 ? " · New best!" : ""} · next round in ${Math.ceil(T.restartIn(t))}`
        : `${Math.ceil(left)} s · Score ${T.score}${T.combo > 1 ? ` · Combo ×${T.combo}` : ""} · Best ${Math.max(T.best, this.bestSaved)}`;
      g.fillStyle = "rgba(20,20,19,.45)";
      const tw = g.measureText(text).width + 28;
      g.beginPath(); g.roundRect(X(0.5) - tw / 2, 12, tw, fs + 16, 12); g.fill();
      g.fillStyle = T.over ? "#d4ff3a" : left < 10 ? "#ffcf4a" : "#fff";
      g.fillText(text, X(0.5), 12 + (fs + 16) / 2);
      const ht = this.hitText;
      if (ht && t - ht.t < 0.8) {
        const k = (t - ht.t) / 0.8;
        g.globalAlpha = 1 - k;
        g.fillStyle = "#d4ff3a";
        g.font = font(700, fs * (1.2 + 0.1 * Math.min(ht.combo, 5)));
        g.fillText(ht.text, X(ht.x), Y(ht.y) - 30 - 40 * k);
        g.globalAlpha = 1;
      }
    }
  }
}
