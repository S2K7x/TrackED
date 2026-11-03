// Superpower mode controller: hands / face / body mask → powers → GPU passes,
// particles, sounds and the small HUD.
//
// Timing (same split as the music mode):
//  - gestures are read in update(), called on EVERY tracking result
//  - simulation (particles, beams, shockwaves…) and drawing run in render(),
//    once per camera frame, with the real frame time step
// Everything visual is drawn on the main WebGL canvas, so photos and videos
// include it; only the HUD (hold rings, score) is on a 2D layer.

import { powerById, powerWants } from "./catalog.js";
import { HandTracks, EnergyCharge, ClapDetector, CircleStroke, Trigger, faceAim } from "./gestures.js";
import { SignHold } from "../gestures.js";
import { bolt, rayToEdge } from "./lightning.js";
import { Particles, GlowBatch, KIND, FIRE, WHITE, mixColor } from "./particles.js";
import { Targets } from "./targets.js";
import { PowerRenderer } from "./fx-gl.js";
import { PowerSfx } from "./sfx.js";
import { hexToRgb } from "../options.js";

const INTENSITY = { subtle: 0.55, strong: 1, epic: 1.7 };
const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

export class PowersMode {
  /**
   * @param {{renderer: import("../renderer.js").Renderer, engine: import("../music/audio.js").AudioEngine, overlay: HTMLCanvasElement}} o
   */
  constructor({ renderer, engine, overlay }) {
    this.gfx = new PowerRenderer(renderer);
    this.sfx = new PowerSfx(engine);
    this.overlay = overlay;
    this.particles = new Particles(4000);
    this.batch = new GlowBatch(7000);
    this.tracks = new HandTracks();
    this.charge = new EnergyCharge();
    this.clap = new ClapDetector();
    this.circle = new CircleStroke();
    this.hold = new SignHold(0.9);
    this.targets = new Targets();
    this.s = {};
    this.faces = [];
    this.aspect = 16 / 9;
    this.color = [1, 0.18, 0.33];
    this.newMask = false;
    this.frame = 0;
    this.bestSaved = 0;      // best training score (restored and saved by the app)
    this.onBest = null;
    this.lastUpdate = 0;
    this.lastRender = 0;
    this.#clear();
  }

  #clear() {
    this.beams = [];
    this.strikes = [];
    this.arcs = { segs: [], at: 0 };
    this.fireballs = [];
    this.waves = [];
    this.wells = [];
    this.portals = [];
    this.drops = [];
    this.invis = { on: false, level: 0 };
    this.frozen = { on: false, level: 0, capture: false };
    this.clones = { on: false, amt: 0 };
    this.aura = { level: 0, charging: false };
    this.laser = { on: false, level: 0, beams: [] };
    this.echo = 0;
    this.flash = 0;
    this.shakeAmp = 0;
    this.holdUI = null;
    this.triggers = { pinch: new Map(), flick: new Map(), push: new Map(), fistIn: new Map() };
    this.particles.clear();
    this.charge.reset();
    this.clap.reset();
    this.circle.reset();
    this.hold.reset();
    this.tracks.reset();
  }

  get power() { return this.s.power; }
  get always() { return this.s.activation === "always"; }
  get k() { return INTENSITY[this.s.intensity] ?? 1; }

  /** @param {object} s  all settings (the power keys are read) */
  configure(s) {
    const changed = s.power !== this.s.power;
    const wasAlways = this.s.activation === "always";
    this.s = { ...s };
    this.color = hexToRgb(s.color || "#ff2d55");
    this.sfx.enabled = s.powerSound !== "off";
    if (!this.sfx.enabled) this.sfx.stopAll();
    if (changed) this.release();
    if (s.training !== "on") this.targets.reset();
    if (this.always && (changed || !wasAlways)) this.#switchOn();
    if (!this.always && wasAlways && !changed) this.#switchOff();
  }

  /** Stops every effect and forgets gesture state (power change, mode change). */
  release() {
    this.sfx.stopAll();
    this.humLoop = this.laserLoop = this.auraLoop = null;
    this.#clear();
    this.gfx.clearHistory();
  }

  deactivate() {
    this.release();
    this.targets.reset();
    this.overlay.getContext("2d").clearRect(0, 0, 1e5, 1e5);
  }

  /** Rebuilds the GPU side after a WebGL context loss. */
  rebuild(renderer) {
    this.gfx = new PowerRenderer(renderer);
    if (this.frozen.on) this.frozen.capture = true;
  }

  /** Extra models this power needs from the tracker. */
  wants() { return powerWants(this.power); }

  /** Forgets the learned room (the camera moved, or the user asked). */
  learnBackground() { this.gfx.resetPlate(); }

  /** Fresh soft person mask (camera space). */
  setPerson(mask) { this.gfx.setPerson(mask); this.newMask = true; }

  /** Face anchors in display space (laser vision). */
  setFaces(faces) { this.faces = faces; this.facesAt = this.lastUpdate; }

  // ---------------- toggled powers ----------------
  #switchOn() {
    const p = this.power;
    if (p === "invisible" && !this.invis.on) { this.invis.on = true; this.sfx.cloak(true); }
    if (p === "freeze" && !this.frozen.on) this.#setFrozen(true, { x: 0.5, y: 0.5 });
    if (p === "clones" && !this.clones.on) this.#setClones(true);
  }

  #switchOff() {
    if (this.invis.on) { this.invis.on = false; this.sfx.cloak(false); }
    if (this.frozen.on) this.#setFrozen(false, { x: 0.5, y: 0.5 });
    if (this.clones.on) this.#setClones(false);
  }

  #setFrozen(on, at) {
    this.frozen.on = on;
    this.sfx.timeStop(on);
    this.#wave(at.x, at.y, 1.3, 1.4);
    this.flash = Math.max(this.flash, 0.35);
    if (on) {
      this.frozen.capture = true;
      // drops hanging in the air
      this.drops = Array.from({ length: Math.round(90 * this.k) }, () => ({ x: Math.random(), y: rand(0.03, 0.97), vx: 0, vy: 0, size: rand(0.003, 0.008) }));
    }
  }

  #setClones(on) {
    this.clones.on = on;
    this.sfx.puff();
    const cx = this.#bodyX();
    for (const off of [-0.52, -0.26, 0.26, 0.52].slice(this.s.cloneCount === "4" ? 0 : 1, this.s.cloneCount === "4" ? 4 : 3)) {
      this.#burst(cx + off, 0.55, 26, { color: [0.85, 0.85, 0.9], speed: 0.25, size: 0.03, life: 0.9, grav: -0.05, drag: 2 });
    }
  }

  /** Rough horizontal position of the body (face, else hands, else the middle). */
  #bodyX() {
    if (this.faces[0]) return this.faces[0].nose.x;
    const tr = this.tracks.tracks;
    return tr.length ? tr.reduce((s, x) => s + x.info.palm.x, 0) / tr.length : 0.5;
  }

  // ---------------- gestures (every tracking result) ----------------
  /**
   * @param {object[][]} hands  landmarks, display space
   * @returns {string} status line
   */
  update(hands, t, aspect = 16 / 9) {
    const dt = this.lastUpdate ? Math.min(0.2, t - this.lastUpdate) : 0;
    this.lastUpdate = t;
    this.aspect = aspect;
    const tracks = this.tracks.update(hands, t, aspect);
    const live = new Set(tracks.map((x) => x.id));
    for (const m of Object.values(this.triggers)) for (const id of m.keys()) if (!live.has(id)) m.delete(id);
    const trig = (kind, tr, cooldown) => {
      const m = this.triggers[kind];
      if (!m.has(tr.id)) m.set(tr.id, new Trigger(cooldown));
      return m.get(tr.id);
    };
    this.holdUI = null;

    switch (this.power) {
      case "wave": {
        const r = this.charge.update(tracks, t, dt, aspect);
        if (r.event === "fire") this.#fireWave(r.fire, t);
        else if (r.event === "fizzle") { this.sfx.fizzle(); this.#burst(r.fire.x, r.fire.y, 18, { color: this.color, speed: 0.3, size: 0.012, life: 0.5 }); }
        break;
      }
      case "lightning": {
        for (const tr of tracks) {
          if (trig("pinch", tr, 0.35).update(tr.info.pinch, t)) this.#strike(tr, t);
        }
        break;
      }
      case "fire": {
        for (const tr of tracks) {
          if (trig("flick", tr, 0.45).update(tr.info.fingers >= 3 && tr.speed > 1.5 && tr.age > 0.3, t)) {
            const v = Math.hypot(tr.vx * aspect, tr.vy), s = Math.max(1.1, v * 0.9) / v;
            this.fireballs.push({ x: tr.info.palm.x, y: tr.info.palm.y, vx: tr.vx * s, vy: tr.vy * s, r: 0.035 * (0.8 + 0.4 * this.k), t0: t });
            this.sfx.whoosh();
          }
        }
        break;
      }
      case "force": {
        for (const tr of tracks) {
          if (trig("push", tr, 0.6).update(tr.info.open && tr.growth > 0.22 && tr.age > 0.3, t)) {
            this.#wave(tr.info.palm.x, tr.info.palm.y, 1.3, 1.2);
            this.sfx.shock();
            this.shakeAmp = Math.max(this.shakeAmp, 0.012);
          }
        }
        break;
      }
      case "invisible": {
        if (this.always) break;
        const tr = tracks.find((x) => x.info.open && x.info.thumb && x.speed < 0.35);
        const r = this.hold.update(tr && tracks.length === 1 ? "palm" : null, t);
        if (tr && r.sign) this.holdUI = { x: tr.info.palm.x, y: tr.info.palm.y, p: r.progress, label: this.invis.on ? "Reappear" : "Vanish" };
        if (r.fire) { this.invis.on = !this.invis.on; this.sfx.cloak(this.invis.on); }
        break;
      }
      case "freeze": {
        if (this.always) break;
        const c = this.clap.update(tracks, t, aspect);
        if (c) this.#setFrozen(!this.frozen.on, c);
        break;
      }
      case "clones": {
        if (this.always) break;
        const tr = tracks.find((x) => x.info.victory && x.speed < 0.5);
        const r = this.hold.update(tr && tracks.length === 1 ? "victory" : null, t);
        if (tr && r.sign) this.holdUI = { x: tr.info.palm.x, y: tr.info.palm.y, p: r.progress, label: this.clones.on ? "Dismiss" : "Clones!" };
        if (r.fire) this.#setClones(!this.clones.on);
        break;
      }
      case "portal": {
        const pointer = tracks.find((x) => x.info.point);
        const c = this.circle.update(pointer ? pointer.info.tip : null, t, aspect);
        if (c) this.#openPortal(c, t);
        for (const tr of tracks) {
          const inside = this.portals.find((p) => !p.closing && Math.hypot((p.x - tr.info.palm.x) * aspect, p.y - tr.info.palm.y) < p.r);
          if (trig("fistIn", tr, 0.5).update(!!inside && tr.info.fist, t)) { inside.closing = true; this.sfx.close(); }
        }
        break;
      }
      case "aura": {
        this.aura.charging = tracks.length === 2 && tracks.every((x) => x.info.fist);
        break;
      }
      case "eyes": {
        const f = this.faces[0];
        const fresh = f && t - (this.facesAt ?? 0) < 0.6;
        const open = fresh ? f.open ?? 0 : 0;
        this.laser.on = this.laser.on ? open > 0.14 : open > 0.24;   // hysteresis
        break;
      }
      default: break;
    }
    return this.#status(hands);
  }

  #status(hands) {
    const p = powerById(this.power);
    if (p.needs.includes("person") && !this.gfx.hasMask) return "Loading body tracking…";
    if (this.power === "eyes" && !this.faces.length) return "Face the camera";
    if (!hands.length && this.power !== "eyes" && !p.toggle) return "Show your hands";
    return p.hint;
  }

  // ---------------- power actions ----------------
  #fireWave(f, t) {
    const power = f.power;
    const dur = 0.7 + 0.9 * power;
    this.beams.push({ x: f.x, y: f.y, dx: f.dx / this.aspect, dy: f.dy, toCamera: f.toCamera, power, t0: t, dur });
    this.sfx.blast(power);
    this.shakeAmp = Math.max(this.shakeAmp, 0.008 + 0.014 * power);
    this.flash = Math.max(this.flash, f.toCamera ? 0.6 * power : 0.25);
    if (f.toCamera) this.#wave(f.x, f.y, 1.6, 1.0 + power);
  }

  #strike(tr, t) {
    const from = tr.info.tip, dir = tr.info.dir;
    const target = this.s.training === "on" ? this.#aimAt(from, dir) : null;
    const end = target ?? rayToEdge(from, dir);
    this.strikes.push({ from, to: { x: end.x, y: end.y }, t0: t, segs: bolt(from, end, { aspect: this.aspect, depth: 7 }), regen: t });
    this.sfx.thunder();
    this.flash = Math.max(this.flash, 0.3);
    this.shakeAmp = Math.max(this.shakeAmp, 0.006);
    this.#burst(end.x, end.y, 30, { color: mixColor(this.color, WHITE, 0.5), speed: 0.6, size: 0.006, life: 0.5, kind: KIND.SPARK, grav: 1.2 });
  }

  /** Nearest training target within ~35° of where the finger points (lightning homes in). */
  #aimAt(from, dir) {
    let best = null, bestCos = Math.cos(0.6);
    const dl = Math.hypot(dir.x * this.aspect, dir.y);
    for (const g of this.targets.list) {
      const vx = (g.x - from.x) * this.aspect, vy = g.y - from.y, vl = Math.hypot(vx, vy);
      const cos = (vx * dir.x * this.aspect + vy * dir.y) / (vl * dl || 1);
      if (cos > bestCos) { bestCos = cos; best = { x: g.x, y: g.y }; }
    }
    return best;
  }

  #openPortal(c, t) {
    if (this.portals.length >= 2) this.portals.shift();
    this.portals.push({ x: c.x, y: c.y, r: Math.max(0.08, c.r * 1.1), t0: t, open: 0, closing: false });
    this.sfx.portal();
    this.#burst(c.x, c.y, 40, { color: mixColor(this.color, [1, 0.7, 0.3], 0.5), speed: 0.5, size: 0.008, life: 0.7, kind: KIND.SPARK });
  }

  /** Shockwave: a ring distortion that expands from (x, y). speed in heights / s. */
  #wave(x, y, speed = 1.2, strength = 1) {
    this.waves.push({ x, y, t0: this.lastRender || this.lastUpdate, speed, strength, life: 0.9 });
    if (this.waves.length > 4) this.waves.shift();
  }

  #burst(x, y, n, { color = WHITE, color1, speed = 0.5, size = 0.01, life = 0.6, kind = KIND.DOT, grav = 0, drag = 1.5 } = {}) {
    const count = Math.round(n * this.k);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
      this.particles.emit({ x, y, vx: (Math.cos(a) * v) / this.aspect, vy: Math.sin(a) * v, life: life * rand(0.6, 1.2), size: size * rand(0.6, 1.3), size1: size * 0.3, color, color1: color1 ?? color, grav, drag, kind });
    }
  }

  #explode(x, y, size = 1, t) {
    this.#burst(x, y, 50 * size, { color: FIRE.core, color1: FIRE.edge, speed: 0.7 * size, size: 0.02 * size, life: 0.8, grav: -0.3, drag: 2.5 });
    this.#burst(x, y, 25 * size, { color: FIRE.mid, speed: 1.1 * size, size: 0.005, life: 0.6, kind: KIND.SPARK, grav: 1.5 });
    this.#wave(x, y, 1.4, 0.9 * size);
    this.sfx.boom(size);
    this.shakeAmp = Math.max(this.shakeAmp, 0.01 * size);
    this.flash = Math.max(this.flash, 0.15 * size);
    this.#hitTargets(this.targets.hitCircle(x, y, 0.08 * size, t, this.aspect));
  }

  #hitTargets(hits) {
    for (const g of hits) {
      this.sfx.hit(this.targets.combo);
      this.#burst(g.x, g.y, 30, { color: mixColor(this.color, WHITE, 0.4), speed: 0.6, size: 0.006, life: 0.6, kind: KIND.SPARK, grav: 0.8 });
      this.#burst(g.x, g.y, 12, { color: this.color, speed: 0.2, size: 0.03, life: 0.5 });
      this.hitText = { x: g.x, y: g.y, text: `+${10 * this.targets.combo}`, t: this.lastRender, combo: this.targets.combo };
    }
    if (hits.length && this.targets.best > this.bestSaved) { this.bestSaved = this.targets.best; this.onBest?.(this.bestSaved); }
  }

  // ---------------- simulation + drawing (every frame) ----------------
  /**
   * @param {HTMLVideoElement} video
   * @param {number} t  seconds
   * @param {{mirror: boolean}} o
   */
  render(video, t, { mirror }) {
    const dt = this.lastRender ? Math.min(0.05, t - this.lastRender) : 0;
    this.lastRender = t;
    if (!this.gfx.begin(video)) return;
    this.frame++;
    const aspect = this.aspect, k = this.k, col = this.color, hot = mixColor(col, WHITE, 0.55);
    const B = this.batch;
    B.reset();
    const tracks = this.tracks.tracks.filter(() => t - this.lastUpdate < 0.4);  // hands lost for a while: no emission
    const training = this.s.training === "on";

    // ---- per power ----
    switch (this.power) {
      case "wave": {
        const c = this.charge;
        if (c.charging && c.center) {
          const r = 0.02 + 0.075 * c.charge * (0.8 + 0.2 * k);
          B.push(c.center.x, c.center.y, c.center.x, c.center.y, mixColor(col, WHITE, 0.25), 1, r, KIND.ORB, t * 3);
          // energy gathering: sparks spiral in
          for (let i = 0; i < 3 * k * dt * 60 * (0.4 + c.charge); i++) {
            const a = Math.random() * Math.PI * 2, d = rand(2.5, 4) * Math.max(r, 0.03);
            const px = c.center.x + (Math.cos(a) * d) / aspect, py = c.center.y + Math.sin(a) * d;
            this.particles.emit({ x: px, y: py, vx: ((c.center.x - px) * 2.5) + (-Math.sin(a) * 0.3) / aspect, vy: (c.center.y - py) * 2.5 + Math.cos(a) * 0.3, life: 0.4, size: 0.004, color: hot, kind: KIND.SPARK, drag: 0.5 });
          }
          if (c.charge > 0.55 && Math.random() < 0.5) {
            const a = Math.random() * Math.PI * 2;
            const end = { x: c.center.x + (Math.cos(a) * r * 2.2) / aspect, y: c.center.y + Math.sin(a) * r * 2.2 };
            for (const sgm of bolt(c.center, end, { depth: 3, aspect, branch: 0 })) B.push(sgm.ax, sgm.ay, sgm.bx, sgm.by, hot, 0.8, 0.003, KIND.LINE);
          }
          this.humLoop ??= this.sfx.loop("hum");
          this.humLoop?.set(0.4 + 0.6 * c.charge, c.charge);
          this.shakeAmp = Math.max(this.shakeAmp, c.charge > 0.8 ? 0.002 : 0);
        } else if (this.humLoop) { this.humLoop.stop(); this.humLoop = null; }
        this.beams = this.beams.filter((b) => t - b.t0 < b.dur);
        for (const b of this.beams) {
          const age = (t - b.t0) / b.dur;
          const env = Math.min(1, age * 8) * (1 - age ** 3);
          // aim with your hands while it fires
          if (tracks.length === 2) {
            b.x = approach(b.x, (tracks[0].info.palm.x + tracks[1].info.palm.x) / 2, 12, dt);
            b.y = approach(b.y, (tracks[0].info.palm.y + tracks[1].info.palm.y) / 2, 12, dt);
          }
          if (b.toCamera) {
            const r = (0.08 + 1.1 * age ** 0.7) * (0.5 + b.power);
            B.push(b.x, b.y, b.x, b.y, mixColor(col, WHITE, 0.4), env, r * 0.6, KIND.ORB, t);
            B.push(b.x, b.y, b.x, b.y, hot, env * 0.8, r, KIND.RING, 0.03 + 0.05 * b.power, t);
            for (let i = 0; i < 6 * k; i++) {
              const a = Math.random() * Math.PI * 2, v = rand(0.8, 2.2);
              this.particles.emit({ x: b.x, y: b.y, vx: (Math.cos(a) * v) / aspect, vy: Math.sin(a) * v, life: 0.5, size: 0.006, color: hot, kind: KIND.SPARK });
            }
            this.flash = Math.max(this.flash, 0.45 * env * b.power);
            if (training) this.#hitTargets(this.targets.hitCircle(b.x, b.y, r * 0.6, t, aspect));
          } else {
            const end = rayToEdge(b, { x: b.dx, y: b.dy });
            const w = (0.025 + 0.05 * b.power) * env * (0.85 + 0.15 * k);
            B.push(b.x, b.y, end.x, end.y, col, 1, w, KIND.BEAM, t * 7);
            B.push(b.x, b.y, b.x, b.y, mixColor(col, WHITE, 0.4), 1, w * 1.6, KIND.ORB, t * 5);
            // impact splash where the beam leaves the picture
            for (let i = 0; i < 5 * k; i++) {
              const a = Math.atan2(-b.dy, -b.dx * aspect) + rand(-1.1, 1.1), v = rand(0.5, 1.6);
              this.particles.emit({ x: end.x, y: end.y, vx: (Math.cos(a) * v) / aspect, vy: Math.sin(a) * v, life: 0.4, size: 0.006, color: hot, kind: KIND.SPARK, grav: 1 });
            }
            this.shakeAmp = Math.max(this.shakeAmp, 0.006 * env * b.power);
            if (training) this.#hitTargets(this.targets.hitSegment(b.x, b.y, end.x, end.y, w, t, aspect));
          }
        }
        break;
      }
      case "lightning": {
        const zapEvery = 0.06;
        if (t - this.arcs.at > zapEvery) {
          this.arcs.at = t;
          this.arcs.segs = [];
          const [a, b] = tracks;
          if (a && b) {
            const gap = Math.hypot((a.info.palm.x - b.info.palm.x) * aspect, a.info.palm.y - b.info.palm.y);
            if (gap < 0.9) {
              const n = gap < 0.35 ? 5 : 3;
              for (let i = 0; i < n; i++) {
                const f = Math.floor(Math.random() * 5);
                this.arcs.segs.push(...bolt(a.info.tips[f], b.info.tips[(f + Math.floor(Math.random() * 2)) % 5], { aspect, depth: 5, jag: 0.28, branch: 0.25 }));
              }
              if (Math.random() < 0.5) this.sfx.zap();
            }
          }
          for (const tr of tracks) {
            if (tr.info.fingers < 3) continue;
            for (let f = 1; f < 5; f++) if (Math.random() < 0.55) this.arcs.segs.push(...bolt(tr.info.tips[f - 1], tr.info.tips[f], { aspect, depth: 3, jag: 0.35, branch: 0 }));
          }
        }
        for (const sgm of this.arcs.segs) B.push(sgm.ax, sgm.ay, sgm.bx, sgm.by, col, 0.9, 0.0035 * sgm.w * (0.8 + 0.3 * k), KIND.LINE);
        this.strikes = this.strikes.filter((s) => t - s.t0 < 0.35);
        for (const s of this.strikes) {
          if (t - s.regen > 0.07) { s.regen = t; s.segs = bolt(s.from, s.to, { aspect, depth: 7 }); }
          const a = 1 - (t - s.t0) / 0.35;
          for (const sgm of s.segs) B.push(sgm.ax, sgm.ay, sgm.bx, sgm.by, hot, a, 0.007 * sgm.w * (0.8 + 0.3 * k), KIND.LINE);
          if (training) this.#hitTargets(this.targets.hitSegment(s.from.x, s.from.y, s.to.x, s.to.y, 0.02, t, aspect));
        }
        break;
      }
      case "fire": {
        for (const tr of tracks) {
          const open = tr.info.fingers >= 3;
          const rate = (open ? 120 : 14) * k * dt;
          for (let i = 0; i < rate; i++) {
            const src = open ? tr.info.tips[Math.floor(Math.random() * 5)] : tr.info.palm;
            const big = open ? tr.info.size * 0.5 : tr.info.size * 0.2;
            this.particles.emit({
              x: src.x + rand(-0.01, 0.01) / aspect, y: src.y + rand(-0.01, 0.01),
              vx: tr.vx * 0.25 + rand(-0.05, 0.05), vy: tr.vy * 0.25 - rand(0.05, 0.25),
              life: rand(0.35, 0.8), size: big * rand(0.6, 1.1), size1: big * 0.15,
              color: open && Math.random() < 0.25 ? FIRE.core : FIRE.mid, color1: FIRE.edge, grav: -0.9, drag: 2.2, alpha: 0.8, kind: KIND.FLAME,
            });
          }
          B.push(tr.info.palm.x, tr.info.palm.y, tr.info.palm.x, tr.info.palm.y, FIRE.mid, open ? 0.35 : 0.2, tr.info.size * 1.1, KIND.DOT);
        }
        this.fireballs = this.fireballs.filter((f) => {
          f.x += f.vx * dt; f.y += f.vy * dt;
          f.vy += 0.15 * dt;
          for (let i = 0; i < 40 * k * dt; i++) {
            this.particles.emit({ x: f.x, y: f.y, vx: rand(-0.06, 0.06), vy: rand(-0.12, 0.02), life: rand(0.3, 0.6), size: f.r * rand(0.6, 1), size1: f.r * 0.2, color: FIRE.mid, color1: FIRE.edge, grav: -0.6, drag: 1.5, alpha: 0.8, kind: KIND.FLAME });
          }
          B.push(f.x, f.y, f.x, f.y, [1, 0.45, 0.1], 1, f.r, KIND.ORB, f.t0 * 10);
          const hit = training && this.targets.list.some((g) => Math.hypot((g.x - f.x) * aspect, g.y - f.y) < g.r + f.r);
          if (hit || f.x < 0.01 || f.x > 0.99 || f.y < 0.01 || f.y > 0.99 || t - f.t0 > 3) {
            this.#explode(clamp01(f.x), clamp01(f.y), 1, t);
            return false;
          }
          return true;
        });
        break;
      }
      case "force": {
        this.wells = [];
        for (const tr of tracks) {
          const p = tr.info.palm;
          if (tr.info.pinch) {
            const c = { x: (tr.info.tip.x + tr.info.thumbTip.x) / 2, y: (tr.info.tip.y + tr.info.thumbTip.y) / 2 };
            const R = 0.09 + 0.04 * k;
            this.wells.push({ x: c.x, y: c.y, r: R, s: -1 });
            B.push(c.x, c.y, c.x, c.y, hot, 0.9, R * 0.3, KIND.RING, 0.006, t);
            for (let i = 0; i < 30 * k * dt; i++) {
              const a = Math.random() * Math.PI * 2, d = R * rand(0.6, 1.4);
              const px = c.x + (Math.cos(a) * d) / aspect, py = c.y + Math.sin(a) * d;
              this.particles.emit({ x: px, y: py, vx: ((c.x - px) * 2) - (Math.sin(a) * 0.5) / aspect, vy: (c.y - py) * 2 + Math.cos(a) * 0.5, life: 0.45, size: 0.004, color: mixColor(col, [1, 0.6, 0.2], 0.4), kind: KIND.SPARK });
            }
            if (training) this.#hitTargets(this.targets.hitCircle(c.x, c.y, R * 0.6, t, aspect));
          } else if (tr.info.open) {
            this.wells.push({ x: p.x, y: p.y, r: tr.info.size * 2.2, s: 0.7 });
            B.push(p.x, p.y, p.x, p.y, col, 0.35, tr.info.size * 1.6, KIND.RING, 0.01, t);
          }
        }
        break;
      }
      case "invisible": {
        if (this.always && !this.invis.on) this.#switchOn();
        const l = this.invis.level;
        if (l > 0.02 && l < 0.98) {
          for (const tr of tracks) this.#burst(tr.info.palm.x, tr.info.palm.y, 2, { color: hot, speed: 0.2, size: 0.006, life: 0.5, kind: KIND.SPARK });
        }
        break;
      }
      case "freeze": {
        if (this.always && !this.frozen.on) this.#switchOn();
        const tips = tracks.flatMap((x) => x.info.tips);
        this.drops = this.drops.filter((d) => {
          if (this.frozen.on) {
            for (const p of tips) {
              const dx = (d.x - p.x) * aspect, dy = d.y - p.y, dd = Math.hypot(dx, dy);
              if (dd < 0.035 && dd > 1e-4) { d.vx += (dx / dd) * 0.25 / aspect; d.vy += (dy / dd) * 0.25; }
            }
            d.vx *= Math.exp(-3 * dt); d.vy *= Math.exp(-3 * dt);
          } else d.vy += 2.5 * dt;                            // time runs again: they fall
          d.x += d.vx * dt; d.y += d.vy * dt;
          B.push(d.x, d.y, d.x - d.vx * 0.02, d.y - d.vy * 0.02 - (this.frozen.on ? 0 : 0.01), [0.75, 0.88, 1], 0.8, d.size, KIND.LINE);
          return d.y < 1.05;
        });
        break;
      }
      case "speed": {
        const fast = tracks.reduce((m, x) => Math.max(m, x.speed), 0);
        this.echo = approach(this.echo, clamp01(0.45 + fast * 0.35), 4, dt);
        for (const tr of tracks) {
          if (tr.speed < 0.9) continue;
          for (let i = 0; i < 40 * k * dt * tr.speed; i++) {
            const p = tr.info.tips[Math.floor(Math.random() * 5)];
            this.particles.emit({ x: p.x, y: p.y, vx: -tr.vx * 0.4, vy: -tr.vy * 0.4, life: 0.35, size: 0.004, color: hot, kind: KIND.SPARK, drag: 3 });
          }
        }
        break;
      }
      case "clones": {
        if (this.always && !this.clones.on) this.#switchOn();
        break;
      }
      case "eyes": {
        const f = this.faces[0];
        this.laser.level = approach(this.laser.level, this.laser.on ? 1 : 0, this.laser.on ? 18 : 10, dt);
        if (f && this.laser.level > 0.02) {
          const aim = faceAim(f, aspect);
          const dx = aim.yaw * 1.8, dy = aim.pitch * 1.8, len = Math.hypot(dx, dy);
          const L = this.laser.level;
          for (const e of aim.eyes) {
            if (len < 0.35) {
              // looking at the camera: the beam comes at you
              const r = f.r * (0.18 + 0.1 * Math.sin(t * 40)) * L;
              B.push(e.x, e.y, e.x, e.y, mixColor(col, WHITE, 0.3), L, r, KIND.ORB, t * 9);
              B.push(e.x, e.y, e.x, e.y, hot, L * 0.6, r * (1.5 + ((t * 3) % 1) * 2), KIND.RING, 0.006, t);
              this.flash = Math.max(this.flash, 0.12 * L);
            } else {
              const end = rayToEdge(e, { x: dx / len / aspect, y: dy / len });
              const w = f.r * 0.12 * L;
              B.push(e.x, e.y, end.x, end.y, col, 1, w, KIND.BEAM, t * 9);
              B.push(e.x, e.y, e.x, e.y, mixColor(col, WHITE, 0.5), L, w * 1.8, KIND.ORB, t * 7);
              for (let i = 0; i < 3 * k; i++) this.particles.emit({ x: end.x, y: end.y, vx: rand(-0.6, 0.6) / aspect, vy: rand(-0.9, 0.2), life: 0.45, size: 0.005, color: hot, kind: KIND.SPARK, grav: 1.6 });
              if (training) this.#hitTargets(this.targets.hitSegment(e.x, e.y, end.x, end.y, w, t, aspect));
            }
          }
          this.laserLoop ??= this.sfx.loop("laser");
          this.laserLoop?.set(L, 0.5);
        } else if (this.laserLoop) { this.laserLoop.stop(); this.laserLoop = null; }
        break;
      }
      case "portal": {
        const pts = this.circle.points;
        for (let i = 1; i < pts.length; i++) B.push(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, hot, 0.25 + 0.6 * (i / pts.length), 0.004, KIND.LINE);
        this.portals = this.portals.filter((p) => {
          if (t - p.t0 > 30) p.closing = true;
          p.open = approach(p.open, p.closing ? 0 : 1, p.closing ? 8 : 3, dt);
          if (p.closing && p.open < 0.02) return false;
          const R = p.r * p.open, rim = mixColor(col, [1, 0.62, 0.25], 0.55);
          B.push(p.x, p.y, p.x, p.y, rim, 1, R, KIND.RING, 0.008 + 0.006 * k, p.t0 * 13);
          for (let i = 0; i < 70 * k * dt * p.open; i++) {
            const a = Math.random() * Math.PI * 2, px = p.x + (Math.cos(a) * R) / aspect, py = p.y + Math.sin(a) * R;
            const v = rand(0.25, 0.6);
            this.particles.emit({ x: px, y: py, vx: (-Math.sin(a) * v) / aspect, vy: Math.cos(a) * v + 0.15, life: rand(0.25, 0.55), size: 0.004, color: rim, kind: KIND.SPARK, grav: 0.8, drag: 1 });
          }
          return true;
        });
        break;
      }
      case "aura": {
        const target = this.always ? Math.max(0.55, this.aura.charging ? 1 : 0) : this.aura.charging ? 1 : 0;
        this.aura.level = approach(this.aura.level, target, this.aura.charging ? 0.9 : 0.5, dt);
        const L = this.aura.level;
        if (L > 0.05) {
          const cx = this.#bodyX();
          for (let i = 0; i < 60 * k * dt * L; i++) {
            this.particles.emit({ x: cx + rand(-0.22, 0.22) / aspect * 2, y: rand(0.45, 1), vx: rand(-0.03, 0.03), vy: -rand(0.2, 0.6) * L, life: rand(0.5, 1.1), size: rand(0.003, 0.007), color: hot, kind: KIND.SPARK, drag: 0.5 });
          }
          if (this.aura.charging) this.shakeAmp = Math.max(this.shakeAmp, 0.004 * L);
          this.auraLoop ??= this.sfx.loop("aura");
          this.auraLoop?.set(0.3 + 0.7 * L, L);
        } else if (this.auraLoop) { this.auraLoop.stop(); this.auraLoop = null; }
        break;
      }
      default: break;
    }

    // ---- toggled levels ----
    this.invis.level = approach(this.invis.level, this.invis.on ? 1 : 0, 2.2, dt);
    this.frozen.level = approach(this.frozen.level, this.frozen.on ? 1 : 0, 6, dt);
    this.clones.amt = approach(this.clones.amt, this.clones.on ? 1 : 0, 3, dt);

    // ---- shockwaves ----
    this.waves = this.waves.filter((w) => t - w.t0 < w.life);
    for (const w of this.waves) {
      const age = t - w.t0, r = w.speed * age, s = w.strength * (1 - age / w.life);
      B.push(w.x, w.y, w.x, w.y, mixColor(col, WHITE, 0.6), s * 0.5, r, KIND.RING, 0.01, w.t0);
      if (training) this.#hitTargets(this.targets.hitRing(w.x, w.y, r, 0.03, t, aspect));
    }

    // ---- training targets ----
    if (training) {
      this.targets.update(dt, t);
      for (const g of this.targets.list) {
        const pulse = 1 + 0.08 * Math.sin(t * 5 + g.id);
        B.push(g.x, g.y, g.x, g.y, [1, 0.85, 0.3], 0.9, g.r * pulse, KIND.RING, 0.005, g.id);
        B.push(g.x, g.y, g.x, g.y, [1, 0.6, 0.2], 0.5, g.r * 0.35, KIND.DOT);
      }
    }

    this.particles.update(dt);
    this.particles.write(B);

    // ---- shake / flash ----
    this.shakeAmp *= Math.exp(-6 * dt);
    this.flash *= Math.exp(-7 * dt);
    const amp = this.s.shake === "off" ? 0 : this.shakeAmp;
    const shake = { x: rand(-amp, amp), y: rand(-amp, amp) };

    // ---- GPU ----
    const needs = powerById(this.power).needs;
    if (this.newMask && (needs.includes("plate") || this.power === "freeze")) { this.gfx.updatePlate(); }
    this.newMask = false;
    if (needs.includes("history") && this.frame % 2 === 0) this.gfx.pushHistory();
    if (this.frozen.capture) { this.gfx.captureFreeze(); this.frozen.capture = false; }
    const portals = this.portals.map((p) => ({ x: p.x, y: p.y, r: p.r, open: p.open }));
    this.gfx.drawWorld({
      mirror, time: t, aspect, color: col, shake,
      invis: this.power === "invisible" ? this.invis.level : 0,
      cloak: { clear: 0, shimmer: 1, ghost: 2 }[this.s.cloak] ?? 1,
      frozen: this.power === "freeze" ? this.frozen.level : 0,
      echo: this.power === "speed" ? this.echo : 0,
      clones: this.power === "clones" ? (this.s.cloneCount === "4" ? 4 : 2) : 0,
      cloneAmt: this.clones.amt,
      aura: this.power === "aura" ? this.aura.level * (0.7 + 0.3 * k) : 0,
      waves: this.waves.map((w) => { const age = t - w.t0; return { x: w.x, y: w.y, r: w.speed * age, s: w.strength * (1 - age / w.life) }; }),
      wells: this.wells,
      portals,
      flash: Math.min(0.85, this.flash),
    });
    this.gfx.drawGlow(B, { aspect, time: t, shake, glow: 0.6 + 0.4 * k });
  }

  // ---------------- HUD (2D layer, not recorded) ----------------
  drawHud(g, w, h, t) {
    g.clearRect(0, 0, w, h);
    const X = (x) => x * w, Y = (y) => y * h;
    const fs = Math.max(12, Math.round(h * 0.024));
    g.font = `600 ${fs}px Urbanist, system-ui, sans-serif`;
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
    if (this.s.training === "on") {
      const T = this.targets;
      g.fillStyle = "rgba(20,20,19,.45)";
      const text = `Score ${T.score}${T.combo > 1 ? ` · Combo ×${T.combo}` : ""} · Best ${Math.max(T.best, this.bestSaved ?? 0)}`;
      const tw = g.measureText(text).width + 28;
      g.beginPath(); g.roundRect(X(0.5) - tw / 2, 12, tw, fs + 16, 12); g.fill();
      g.fillStyle = "#fff";
      g.fillText(text, X(0.5), 12 + (fs + 16) / 2);
      const ht = this.hitText;
      if (ht && t - ht.t < 0.8) {
        const k = (t - ht.t) / 0.8;
        g.globalAlpha = 1 - k;
        g.fillStyle = "#d4ff3a";
        g.font = `700 ${Math.round(fs * (1.2 + 0.1 * Math.min(ht.combo, 5)))}px Urbanist, system-ui, sans-serif`;
        g.fillText(ht.text, X(ht.x), Y(ht.y) - 30 - 40 * k);
        g.globalAlpha = 1;
      }
    }
  }
}
