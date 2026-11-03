// One small module per superpower. Each factory returns an object with:
//   gesture(c, dt)  read the hands / face; called on every tracking result
//   frame(c, dt)    simulate and emit glows, lights, warps; called every frame
//   setOn(c, on)    (toggled powers) switch on or off, e.g. for "Always on"
//   hud(g, X, Y, c) (optional) draw on the 2D HUD
//   stop()          (optional) release continuous sounds
// `c` is the PowersMode controller: shared helpers (burst, wave, light, scorch,
// heat, flare, hit tests, sound) and the per-frame world uniforms in c.world.
//
// Realism rules used everywhere: every glowing thing also LIGHTS the room
// (c.light), hot things make the air above them shimmer (c.heat), impacts
// leave scorch marks that cool down (c.scorch), big hits shake the camera and
// split its colours a little (c.shake, c.aberr).

import { EnergyCharge, ClapDetector, CircleStroke, faceAim, PinchZoom, Spring } from "./gestures.js";
import { SignHold } from "../gestures.js";
import { bolt, rayToEdge } from "./lightning.js";
import { KIND, FIRE, WHITE, mixColor } from "./particles.js";

const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
const ICE = [0.72, 0.9, 1];
const WARM = [1, 0.55, 0.18];

/** Point at distance `reach` along d from p, stopping at the picture edge. */
function along(p, d, reach) {
  const e = rayToEdge(p, d);
  const t = Math.min(e.t, reach);
  return { x: p.x + d.x * t, y: p.y + d.y * t, edge: t === e.t };
}

// ---------------------------------------------------------------- energy wave
function wave() {
  const charge = new EnergyCharge();
  const beams = [];
  let hum = null;
  return {
    charge,
    beams,
    gesture(c, dt) {
      const r = charge.update(c.tracks, c.t, dt, c.aspect);
      if (r.event === "fire") {
        const f = r.fire;
        beams.push({ x: f.x, y: f.y, dx: f.dx / c.aspect, dy: f.dy, toCamera: f.toCamera, power: f.power, t0: c.t, dur: 0.7 + 0.9 * f.power });
        c.sfx.blast(f.power);
        c.shake(0.008 + 0.014 * f.power);
        c.flash(f.toCamera ? 0.6 * f.power : 0.25);
        c.aberr(0.015 + 0.03 * f.power);
        if (f.toCamera) c.wave(f.x, f.y, 1.6, 1 + f.power);
        if (f.power > 0.6) c.moment("blast");
      } else if (r.event === "fizzle") {
        c.sfx.fizzle();
        c.burst(r.fire.x, r.fire.y, 18, { color: c.color, speed: 0.3, size: 0.012, life: 0.5 });
      }
    },
    frame(c, dt) {
      const { B, aspect, k, color: col, hot, t } = c;
      if (charge.charging && charge.center) {
        const p = charge.center, q = charge.charge;
        const r = 0.02 + 0.075 * q * (0.8 + 0.2 * k);
        B.push(p.x, p.y, p.x, p.y, mixColor(col, WHITE, 0.25), 1, r, KIND.ORB, t * 3);
        c.light(p.x, p.y, 0.12 + 0.25 * q, 0.5 + 1.2 * q, mixColor(col, WHITE, 0.3));   // your hands glow in its light
        c.heat(p.x, p.y - r, r * 3, 0.5 * q);
        for (let i = 0; i < 3 * k * dt * 60 * (0.4 + q); i++) {                          // energy gathers in
          const a = Math.random() * Math.PI * 2, d = rand(2.5, 4) * Math.max(r, 0.03);
          const px = p.x + (Math.cos(a) * d) / aspect, py = p.y + Math.sin(a) * d;
          c.particles.emit({ x: px, y: py, vx: (p.x - px) * 2.5 - (Math.sin(a) * 0.3) / aspect, vy: (p.y - py) * 2.5 + Math.cos(a) * 0.3, life: 0.4, size: 0.004, color: hot, kind: KIND.SPARK, drag: 0.5 });
        }
        if (q > 0.55 && Math.random() < 0.5) {
          const a = Math.random() * Math.PI * 2;
          const end = { x: p.x + (Math.cos(a) * r * 2.2) / aspect, y: p.y + Math.sin(a) * r * 2.2 };
          for (const s of bolt(p, end, { depth: 3, aspect, branch: 0 })) B.push(s.ax, s.ay, s.bx, s.by, hot, 0.8, 0.003, KIND.LINE);
        }
        hum ??= c.sfx.loop("hum");
        hum?.set(0.4 + 0.6 * q, q);
        if (q > 0.8) c.shake(0.002);
      } else if (hum) { hum.stop(); hum = null; }

      for (let i = beams.length - 1; i >= 0; i--) {
        const b = beams[i];
        const age = (t - b.t0) / b.dur;
        if (age >= 1) { beams.splice(i, 1); continue; }
        const env = Math.min(1, age * 8) * (1 - age ** 3);
        const [h1, h2] = c.tracks;
        if (h1 && h2) {                                       // aim with your hands while it fires
          b.x = approach(b.x, (h1.info.palm.x + h2.info.palm.x) / 2, 12, dt);
          b.y = approach(b.y, (h1.info.palm.y + h2.info.palm.y) / 2, 12, dt);
        }
        if (b.toCamera) {
          const r = (0.08 + 1.1 * age ** 0.7) * (0.5 + b.power);
          B.push(b.x, b.y, b.x, b.y, mixColor(col, WHITE, 0.4), env, r * 0.6, KIND.ORB, t);
          B.push(b.x, b.y, b.x, b.y, hot, env * 0.8, r, KIND.RING, 0.03 + 0.05 * b.power, t);
          c.light(b.x, b.y, 0.4 + r, 2.5 * env * b.power, mixColor(col, WHITE, 0.4));
          for (let j = 0; j < 6 * k; j++) {
            const a = Math.random() * Math.PI * 2, v = rand(0.8, 2.2);
            c.particles.emit({ x: b.x, y: b.y, vx: (Math.cos(a) * v) / aspect, vy: Math.sin(a) * v, life: 0.5, size: 0.006, color: hot, kind: KIND.SPARK });
          }
          c.flash(0.45 * env * b.power);
          c.vignette(0.35 * env);
          c.hitCircle(b.x, b.y, r * 0.6);
        } else {
          const end = rayToEdge(b, { x: b.dx, y: b.dy });
          const w = (0.025 + 0.05 * b.power) * env * (0.85 + 0.15 * k);
          B.push(b.x, b.y, end.x, end.y, col, 1, w, KIND.BEAM, t * 7);
          B.push(b.x, b.y, b.x, b.y, mixColor(col, WHITE, 0.4), 1, w * 1.6, KIND.ORB, t * 5);
          for (let j = 0; j <= 2; j++) {                      // the beam lights everything along its path
            const f = j / 2;
            c.light(b.x + (end.x - b.x) * f, b.y + (end.y - b.y) * f, 0.18 + 0.1 * b.power, 1.1 * env * b.power, col);
          }
          c.heat((b.x + end.x) / 2, (b.y + end.y) / 2, 0.2, 0.8 * env);
          for (let j = 0; j < 5 * k; j++) {
            const a = Math.atan2(-b.dy, -b.dx * aspect) + rand(-1.1, 1.1), v = rand(0.5, 1.6);
            c.particles.emit({ x: end.x, y: end.y, vx: (Math.cos(a) * v) / aspect, vy: Math.sin(a) * v, life: 0.4, size: 0.006, color: hot, kind: KIND.SPARK, grav: 1 });
          }
          c.shake(0.006 * env * b.power);
          c.hitSegment(b.x, b.y, end.x, end.y, w);
        }
      }
    },
    hud(g, X, Y, c) {
      if (!charge.charging || !charge.center) return;
      const p = charge.center, r = Math.max(40, Y(0.06 + 0.075 * charge.charge) * 1.6);
      g.lineWidth = 4;
      g.strokeStyle = "rgba(255,255,255,.25)";
      g.beginPath(); g.arc(X(p.x), Y(p.y), r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = charge.charge >= 1 ? "#d4ff3a" : "#fff";
      g.beginPath(); g.arc(X(p.x), Y(p.y), r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge.charge); g.stroke();
      g.fillStyle = "#fff";
      g.fillText(charge.charge >= 1 ? "Full power!" : `${Math.round(charge.charge * 100)}%`, X(p.x), Y(p.y) - r - 14);
    },
    stop() { hum?.stop(); hum = null; },
  };
}

// ---------------------------------------------------------------- lightning
function lightning() {
  let arcs = [], at = 0;
  const strikes = [];
  return {
    strikes,
    gesture(c) {
      for (const tr of c.tracks) {
        if (!c.trig("pinch", tr, 0.35).update(tr.info.pinch, c.t)) continue;
        const from = tr.info.tip, dir = tr.info.dir;
        const target = c.aimAt(from, dir);
        // a bolt strikes a spot in the room (not the edge of the picture) and scorches it
        const end = target ?? along(from, dir, rand(0.35, 0.55));
        strikes.push({ from, to: { x: end.x, y: end.y }, t0: c.t, segs: bolt(from, end, { aspect: c.aspect, depth: 7 }), regen: c.t });
        c.sfx.thunder();
        c.flash(0.3);
        c.shake(0.006);
        c.aberr(0.012);
        c.scorch(end.x, end.y, 0.035);
        c.flare(end.x, end.y, 0.3, 2, mixColor(c.color, WHITE, 0.5), 0.35);
        c.burst(end.x, end.y, 30, { color: c.hot, speed: 0.6, size: 0.006, life: 0.5, kind: KIND.SPARK, grav: 1.2 });
        c.moment("strike");
      }
    },
    frame(c) {
      const { B, aspect, k, color: col, hot, t, tracks } = c;
      if (t - at > 0.06) {
        at = t;
        arcs = [];
        const [a, b] = tracks;
        if (a && b) {
          const gap = Math.hypot((a.info.palm.x - b.info.palm.x) * aspect, a.info.palm.y - b.info.palm.y);
          if (gap < 0.9) {
            for (let i = 0, n = gap < 0.35 ? 5 : 3; i < n; i++) {
              const f = Math.floor(Math.random() * 5);
              arcs.push(...bolt(a.info.tips[f], b.info.tips[(f + Math.floor(Math.random() * 2)) % 5], { aspect, depth: 5, jag: 0.28, branch: 0.25 }));
            }
            if (Math.random() < 0.5) c.sfx.zap();
          }
        }
        for (const tr of tracks) {
          if (tr.info.fingers < 3) continue;
          for (let f = 1; f < 5; f++) if (Math.random() < 0.55) arcs.push(...bolt(tr.info.tips[f - 1], tr.info.tips[f], { aspect, depth: 3, jag: 0.35, branch: 0 }));
        }
      }
      for (const s of arcs) B.push(s.ax, s.ay, s.bx, s.by, col, 0.9, 0.0035 * s.w * (0.8 + 0.3 * k), KIND.LINE);
      // electric light flickers on your hands and the room
      for (const tr of tracks) if (tr.info.fingers >= 3) c.light(tr.info.palm.x, tr.info.palm.y, 0.16, rand(0.15, 0.6), mixColor(col, WHITE, 0.4));
      if (tracks.length === 2 && arcs.length) {
        const [a, b] = tracks;
        c.light((a.info.palm.x + b.info.palm.x) / 2, (a.info.palm.y + b.info.palm.y) / 2, 0.25, rand(0.3, 0.9), mixColor(col, WHITE, 0.4));
      }
      for (let i = strikes.length - 1; i >= 0; i--) {
        const s = strikes[i];
        if (t - s.t0 > 0.35) { strikes.splice(i, 1); continue; }
        if (t - s.regen > 0.07) { s.regen = t; s.segs = bolt(s.from, s.to, { aspect, depth: 7 }); }
        const a = 1 - (t - s.t0) / 0.35;
        for (const g of s.segs) B.push(g.ax, g.ay, g.bx, g.by, hot, a, 0.007 * g.w * (0.8 + 0.3 * k), KIND.LINE);
        c.hitSegment(s.from.x, s.from.y, s.to.x, s.to.y, 0.02);
      }
    },
  };
}

// ---------------------------------------------------------------- pyro
function fire() {
  const balls = [];
  return {
    balls,
    gesture(c) {
      for (const tr of c.tracks) {
        if (!c.trig("flick", tr, 0.45).update(tr.info.fingers >= 3 && tr.speed > 1.5 && tr.age > 0.3, c.t)) continue;
        const v = Math.hypot(tr.vx * c.aspect, tr.vy), s = Math.max(1.1, v * 0.9) / v;
        balls.push({ x: tr.info.palm.x, y: tr.info.palm.y, vx: tr.vx * s, vy: tr.vy * s, r: 0.035 * (0.8 + 0.4 * c.k), t0: c.t });
        c.sfx.whoosh();
      }
    },
    frame(c, dt) {
      const { B, aspect, k, t } = c;
      for (const tr of c.tracks) {
        const open = tr.info.fingers >= 3, p = tr.info.palm;
        for (let i = 0; i < (open ? 120 : 14) * k * dt; i++) {
          const src = open ? tr.info.tips[Math.floor(Math.random() * 5)] : p;
          const big = tr.info.size * (open ? 0.5 : 0.2);
          c.particles.emit({
            x: src.x + rand(-0.01, 0.01) / aspect, y: src.y + rand(-0.01, 0.01),
            vx: tr.vx * 0.25 + rand(-0.05, 0.05), vy: tr.vy * 0.25 - rand(0.05, 0.25),
            life: rand(0.35, 0.8), size: big * rand(0.6, 1.1), size1: big * 0.15,
            color: open && Math.random() < 0.25 ? FIRE.core : FIRE.mid, color1: FIRE.edge, grav: -0.9, drag: 2.2, alpha: 0.8, kind: KIND.FLAME,
          });
        }
        if (open && Math.random() < 6 * dt) c.particles.emit({ x: p.x, y: p.y - tr.info.size, vx: rand(-0.05, 0.05), vy: -rand(0.3, 0.6), life: rand(0.8, 1.4), size: 0.003, color: WARM, kind: KIND.SPARK, drag: 0.6 });
        B.push(p.x, p.y, p.x, p.y, FIRE.mid, open ? 0.35 : 0.2, tr.info.size * 1.1, KIND.DOT);
        // firelight: warm, flickering, on your hand, face and the wall
        c.light(p.x, p.y - tr.info.size * 0.6, open ? 0.22 : 0.12, (open ? 0.7 : 0.25) * (0.75 + 0.25 * Math.sin(t * 23 + tr.id) * Math.sin(t * 7.3)), WARM);
        if (open) c.heat(p.x, p.y - tr.info.size * 2, tr.info.size * 2.2, 1);
      }
      for (let i = balls.length - 1; i >= 0; i--) {
        const f = balls[i];
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.vy += 0.15 * dt;
        for (let j = 0; j < 40 * k * dt; j++) {
          c.particles.emit({ x: f.x, y: f.y, vx: rand(-0.06, 0.06), vy: rand(-0.12, 0.02), life: rand(0.3, 0.6), size: f.r * rand(0.6, 1), size1: f.r * 0.2, color: FIRE.mid, color1: FIRE.edge, grav: -0.6, drag: 1.5, alpha: 0.8, kind: KIND.FLAME });
        }
        B.push(f.x, f.y, f.x, f.y, [1, 0.45, 0.1], 1, f.r, KIND.ORB, f.t0 * 10);
        c.light(f.x, f.y, 0.2, 0.9, WARM);
        c.heat(f.x, f.y, f.r * 3, 0.8);
        const hit = c.targetsList.some((g) => Math.hypot((g.x - f.x) * aspect, g.y - f.y) < g.r + f.r);
        if (hit || f.x < 0.01 || f.x > 0.99 || f.y < 0.01 || f.y > 0.99 || t - f.t0 > 3) {
          c.explode(clamp01(f.x), clamp01(f.y), 1);
          balls.splice(i, 1);
        }
      }
    },
  };
}

// ---------------------------------------------------------------- force
function force() {
  return {
    gesture(c) {
      for (const tr of c.tracks) {
        if (!c.trig("push", tr, 0.6).update(tr.info.open && tr.growth > 0.22 && tr.age > 0.3, c.t)) continue;
        c.wave(tr.info.palm.x, tr.info.palm.y, 1.3, 1.2);
        c.sfx.shock();
        c.shake(0.012);
        c.aberr(0.03);
        c.moment("push");
      }
    },
    frame(c, dt) {
      const { B, aspect, k, color: col, hot, t } = c;
      for (const tr of c.tracks) {
        const p = tr.info.palm;
        if (tr.info.pinch) {
          const h = { x: (tr.info.tip.x + tr.info.thumbTip.x) / 2, y: (tr.info.tip.y + tr.info.thumbTip.y) / 2 };
          const R = 0.09 + 0.04 * k;
          c.world.wells.push({ x: h.x, y: h.y, r: R, s: -1 });
          B.push(h.x, h.y, h.x, h.y, hot, 0.9, R * 0.3, KIND.RING, 0.006, t);           // the photon ring
          for (let i = 0; i < 30 * k * dt; i++) {                                         // accretion disc
            const a = Math.random() * Math.PI * 2, d = R * rand(0.6, 1.4);
            const px = h.x + (Math.cos(a) * d) / aspect, py = h.y + Math.sin(a) * d;
            c.particles.emit({ x: px, y: py, vx: (h.x - px) * 2 - (Math.sin(a) * 0.5) / aspect, vy: (h.y - py) * 2 + Math.cos(a) * 0.5, life: 0.45, size: 0.004, color: mixColor(col, [1, 0.6, 0.2], 0.4), kind: KIND.SPARK });
          }
          c.light(h.x, h.y, 0.12, 0.35, mixColor(col, [1, 0.6, 0.2], 0.4));
          c.hitCircle(h.x, h.y, R * 0.6);
        } else if (tr.info.open) {
          c.world.wells.push({ x: p.x, y: p.y, r: tr.info.size * 2.2, s: 0.7 });
          B.push(p.x, p.y, p.x, p.y, col, 0.35, tr.info.size * 1.6, KIND.RING, 0.01, t);
          c.light(p.x, p.y, 0.15, 0.25, col);
        }
      }
    },
  };
}

// ---------------------------------------------------------------- shield (new)
function shield() {
  let level = 0, pos = null, R = 0.1;
  const hits = [];
  let was = false;
  return {
    gesture(c) {
      const tr = c.tracks.find((x) => x.info.open && x.info.thumb);
      const on = !!tr;
      if (on) { pos = pos ? { x: approach(pos.x, tr.info.palm.x, 25, 1 / 30), y: approach(pos.y, tr.info.palm.y, 25, 1 / 30) } : { ...tr.info.palm }; R = tr.info.size * 2.3; }
      if (on && !was) c.sfx.shieldUp();
      was = on;
      if (!pos || !on) return;
      // poke it with your other hand: it ripples
      for (const other of c.tracks) {
        if (other === tr) continue;
        const d = Math.hypot((other.info.tip.x - pos.x) * c.aspect, other.info.tip.y - pos.y);
        if (c.trig("poke", other, 0.25).update(d < R * 1.05 && d > R * 0.6, c.t)) { hits.push(c.t); c.sfx.ping(); }
      }
      if (c.trig("bash", tr, 0.6).update(tr.growth > 0.22 && tr.age > 0.3, c.t)) {
        c.wave(pos.x, pos.y, 1.4, 1.2);
        c.sfx.shock();
        c.shake(0.01);
        c.aberr(0.025);
        hits.push(c.t);
        c.moment("bash");
      }
    },
    frame(c, dt) {
      const on = c.tracks.some((x) => x.info.open && x.info.thumb);
      level = approach(level, on ? 1 : 0, on ? 10 : 6, dt);
      if (level < 0.01 || !pos) return;
      while (hits.length && c.t - hits[0] > 0.8) hits.shift();
      const age = hits.length ? (c.t - hits[hits.length - 1]) / 0.8 : -1;
      const col = mixColor(c.color, [0.5, 0.85, 1], 0.45);
      c.B.push(pos.x, pos.y, pos.x, pos.y, col, 0.9 * level, R * (0.7 + 0.3 * level), KIND.SHIELD, age, 0);
      c.world.wells.push({ x: pos.x, y: pos.y, r: R, s: 0.15 * level });                 // the field bends light a little
      c.light(pos.x, pos.y, R * 1.6, 0.35 * level + (age >= 0 ? 0.8 * (1 - age) : 0), col);
      if (c.hitCircle(pos.x, pos.y, R).length) hits.push(c.t);
    },
  };
}

// ---------------------------------------------------------------- frost (new)
function frost() {
  const patches = [], shards = [];
  let creep = 0, crackle = 0;
  return {
    patches,
    gesture(c) {
      for (const tr of c.tracks) {
        if (!c.trig("flick", tr, 0.45).update(tr.info.fingers >= 3 && tr.speed > 1.5 && tr.age > 0.3, c.t)) continue;
        const v = Math.hypot(tr.vx * c.aspect, tr.vy), s = Math.max(1.3, v) / v;
        shards.push({ x: tr.info.palm.x, y: tr.info.palm.y, vx: tr.vx * s, vy: tr.vy * s, t0: c.t });
        c.sfx.whoosh();
      }
    },
    frame(c, dt) {
      const { B, aspect, k, t } = c;
      const open = c.tracks.filter((x) => x.info.open);
      for (const tr of open) {
        const p = tr.info.palm;
        for (let i = 0; i < 25 * k * dt; i++) {                                // icy mist rolling off your hand
          const src = tr.info.tips[Math.floor(Math.random() * 5)];
          c.particles.emit({ x: src.x, y: src.y, vx: rand(-0.04, 0.04) + tr.vx * 0.2, vy: rand(-0.02, 0.06), life: rand(0.8, 1.6), size: 0.012, size1: 0.045, color: ICE, alpha: 0.28, drag: 1.2, grav: 0.03 });
        }
        if (Math.random() < 10 * k * dt) c.particles.emit({ x: p.x + rand(-0.05, 0.05), y: p.y + rand(-0.05, 0.05), vx: rand(-0.05, 0.05), vy: rand(0.02, 0.1), life: 1.2, size: 0.003, color: WHITE, kind: KIND.SPARK, drag: 0.5 });
        c.light(p.x, p.y, 0.2, 0.35, ICE);
        // hold the palm still: frost spreads on the "glass" around it
        if (tr.speed < 0.6) {
          let patch = patches.find((q) => Math.hypot((q.x - p.x) * aspect, q.y - p.y) < q.r * 0.8);
          if (!patch) {
            if (patches.length >= 4) patches.shift();
            patch = { x: p.x, y: p.y, r: 0.04, s: 0.2 };
            patches.push(patch);
          }
          patch.r = Math.min(0.24, patch.r + 0.09 * dt);
          patch.s = Math.min(1, patch.s + 1.5 * dt);
          if ((crackle -= dt) < 0) { crackle = rand(0.08, 0.2); c.sfx.crackle(); }
        }
      }
      // both palms open and still: the whole screen frosts over from the edges
      const still = open.length === 2 && open.every((x) => x.speed < 0.6);
      creep = still ? Math.min(1, creep + 0.22 * dt) : Math.max(0, creep - 0.03 * dt);
      for (let i = patches.length - 1; i >= 0; i--) {
        patches[i].s -= dt / 25;                                                      // slowly melts
        if (patches[i].s <= 0) patches.splice(i, 1);
      }
      for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.x += s.vx * dt; s.y += s.vy * dt;
        B.push(s.x - s.vx * 0.04, s.y - s.vy * 0.04, s.x, s.y, ICE, 1, 0.007, KIND.LINE);
        c.light(s.x, s.y, 0.12, 0.4, ICE);
        if (Math.random() < 0.6) c.particles.emit({ x: s.x, y: s.y, vx: rand(-0.05, 0.05), vy: rand(-0.05, 0.05), life: 0.5, size: 0.01, size1: 0.025, color: ICE, alpha: 0.3 });
        const hit = c.targetsList.some((g) => Math.hypot((g.x - s.x) * aspect, g.y - s.y) < g.r + 0.01);
        if (hit || s.x < 0.01 || s.x > 0.99 || s.y < 0.01 || s.y > 0.99 || t - s.t0 > 2) {
          const x = clamp01(s.x), y = clamp01(s.y);
          c.burst(x, y, 35, { color: ICE, color1: WHITE, speed: 0.7, size: 0.005, life: 0.6, kind: KIND.SPARK, grav: 1.4 });
          c.sfx.shatter();
          c.hitCircle(x, y, 0.06);
          if (patches.length >= 4) patches.shift();
          patches.push({ x, y, r: 0.1, s: 1 });
          shards.splice(i, 1);
        }
      }
      c.world.frost = creep;
      c.world.frostPts = patches;
    },
  };
}

// ---------------------------------------------------------------- reality warp (new)
function warp() {
  const grabs = new Map();       // hand id → grab
  return {
    gesture(c) {
      const seen = new Set();
      for (const tr of c.tracks) {
        seen.add(tr.id);
        const p = { x: (tr.info.tip.x + tr.info.thumbTip.x) / 2, y: (tr.info.tip.y + tr.info.thumbTip.y) / 2 };
        let g = grabs.get(tr.id);
        if (tr.info.pinch) {
          if (!g || !g.held) {
            g = { ox: p.x, oy: p.y, x: p.x, y: p.y, sx: new Spring(), sy: new Spring(), held: true };
            grabs.set(tr.id, g);
            c.sfx.grab();
          }
          g.x = p.x; g.y = p.y;
        } else if (g?.held) { g.held = false; c.sfx.boing(); }
      }
      for (const [id, g] of grabs) if (!seen.has(id) && g.held) { g.held = false; c.sfx.boing(); }
    },
    frame(c, dt) {
      for (const [id, g] of grabs) {
        if (g.held) { g.sx.set(g.x - g.ox); g.sy.set(g.y - g.oy); }
        else { g.sx.step(0, dt); g.sy.step(0, dt); }
        const dx = g.sx.x, dy = g.sy.x, stretch = Math.hypot(dx * c.aspect, dy);
        if (!g.held && stretch < 0.0015 && Math.abs(g.sx.v) + Math.abs(g.sy.v) < 0.01) { grabs.delete(id); continue; }
        if (c.world.drags.length < 2) c.world.drags.push({ x: g.ox + dx, y: g.oy + dy, dx, dy, r: 0.11 + stretch * 0.4 });
        if (g.held) c.B.push(g.ox + dx, g.oy + dy, g.ox + dx, g.oy + dy, c.hot, 0.5, 0.025, KIND.RING, 0.004, id);
        c.aberr(Math.min(0.02, stretch * 0.08));
      }
    },
  };
}

// ---------------------------------------------------------------- size shift (new)
function size() {
  const zoom = new PinchZoom();
  let shown = 1, hum = null, zooming = false;
  return {
    zoom,
    gesture(c) {
      const r = zoom.update(c.tracks, c.aspect);
      zooming = r.active;
      if (c.tracks.length === 2 && c.tracks.every((x) => x.info.fist) && Math.abs(zoom.scale - 1) > 0.02) {
        zoom.reset();
        c.sfx.boing();
      }
    },
    frame(c, dt) {
      shown = approach(shown, zoom.scale, 8, dt);
      if (zooming) { hum ??= c.sfx.loop("hum"); hum?.set(0.35, clamp01((shown - 0.35) / 1.45)); }
      else if (hum) { hum.stop(); hum = null; }
      if (!c.body) return;
      c.world.move = { ax: c.body.cx, ay: c.body.bottom, scale: shown, dx: 0, dy: 0, amt: clamp01(Math.abs(shown - 1) * 25) };
      if (zooming) {
        for (const tr of c.tracks) c.light(tr.info.tip.x, tr.info.tip.y, 0.08, 0.4, c.color);
        const [a, b] = c.tracks;
        c.B.push(a.info.tip.x, a.info.tip.y, b.info.tip.x, b.info.tip.y, c.hot, 0.35, 0.003, KIND.LINE);
      }
    },
    hud(g, X, Y, c) {
      if (!zooming || c.tracks.length < 2) return;
      const [a, b] = c.tracks;
      g.fillStyle = "#fff";
      g.fillText(`×${shown.toFixed(2)}`, X((a.info.tip.x + b.info.tip.x) / 2), Y(Math.min(a.info.tip.y, b.info.tip.y)) - 24);
    },
    stop() { hum?.stop(); hum = null; },
  };
}

// ---------------------------------------------------------------- teleport (new)
function teleport() {
  const hold = new SignHold(0.7);
  let target = 0, from = 0, shown = 0, t0 = -10;
  return {
    get offset() { return target; },
    gesture(c) {
      const tr = c.tracks.find((x) => x.info.point && x.speed < 0.45);
      const r = hold.update(tr ? "point" : null, c.t);
      if (tr && r.sign) c.holdUI = { x: tr.info.tip.x, y: tr.info.tip.y, p: r.progress, label: Math.abs(tr.info.dir.x * c.aspect) < 0.5 ? "Home" : tr.info.dir.x > 0 ? "Blink →" : "← Blink" };
      if (!r.fire || !c.body) return;
      // point left / right: blink a third of the picture that way; point up or down: come back
      const side = Math.abs(tr.info.dir.x * c.aspect) < 0.5 ? 0 : Math.sign(tr.info.dir.x);
      const next = side === 0 ? 0 : Math.max(0.12 - c.body.cx, Math.min(0.88 - c.body.cx, target + side * 0.32));
      if (Math.abs(next - target) < 0.02) return;
      from = shown; target = next; t0 = c.t;
      c.burst(c.body.cx + from, c.body.cy, 50, { color: c.hot, speed: 0.5, size: 0.006, life: 0.6, kind: KIND.SPARK });
      c.sfx.teleport();
      c.flash(0.2);
      c.aberr(0.03);
      c.moment("teleport");
    },
    frame(c) {
      const p = clamp01((c.t - t0) / 0.3);
      const e = p * p * (3 - 2 * p);
      const was = shown;
      shown = from + (target - from) * e;
      if (p < 1 && c.body) {
        c.light(c.body.cx + shown, c.body.cy, 0.3, 1.2 * Math.sin(p * Math.PI), mixColor(c.color, WHITE, 0.4));
        if (Math.random() < 0.8) c.particles.emit({ x: c.body.cx + shown, y: rand(c.body.top, c.body.bottom), vx: -(shown - was) * 20, vy: 0, life: 0.3, size: 0.004, color: c.hot, kind: KIND.SPARK });
        if (was !== shown && p > 0.9) c.burst(c.body.cx + target, c.body.cy, 2, { color: c.hot, speed: 0.4, size: 0.006, life: 0.5, kind: KIND.SPARK });
      }
      if (!c.body) return;
      const glitch = p < 1 ? Math.sin(p * Math.PI) : 0;
      const active = Math.abs(shown) > 0.002 || Math.abs(target) > 0.002;
      c.world.move = { ax: c.body.cx, ay: c.body.bottom, scale: 1, dx: shown, dy: 0, amt: active ? 1 - 0.35 * glitch : 0 };
    },
  };
}

// ---------------------------------------------------------------- invisibility
function invisible() {
  const hold = new SignHold(0.9);
  const st = { on: false, level: 0 };
  return {
    st,
    setOn(c, on) { if (st.on !== on) { st.on = on; c.sfx.cloak(on); } },
    gesture(c) {
      if (c.always) return;
      const tr = c.tracks.find((x) => x.info.open && x.info.thumb && x.speed < 0.35);
      const r = hold.update(tr && c.tracks.length === 1 ? "palm" : null, c.t);
      if (tr && r.sign) c.holdUI = { x: tr.info.palm.x, y: tr.info.palm.y, p: r.progress, label: st.on ? "Reappear" : "Vanish" };
      if (r.fire) { this.setOn(c, !st.on); if (st.on) c.moment("vanish"); }
    },
    frame(c, dt) {
      if (c.always && !st.on) this.setOn(c, true);
      st.level = approach(st.level, st.on ? 1 : 0, 2.2, dt);
      if (st.level > 0.02 && st.level < 0.98) for (const tr of c.tracks) c.burst(tr.info.palm.x, tr.info.palm.y, 2, { color: c.hot, speed: 0.2, size: 0.006, life: 0.5, kind: KIND.SPARK });
      c.world.invis = st.level;
    },
  };
}

// ---------------------------------------------------------------- time stop
function freeze() {
  const clap = new ClapDetector();
  const st = { on: false, level: 0 };
  let drops = [];
  const set = (c, on, at) => {
    st.on = on;
    c.sfx.timeStop(on);
    c.wave(at.x, at.y, 1.3, 1.4);
    c.flash(0.35);
    c.aberr(0.025);
    if (on) {
      c.requestFreeze();
      drops = Array.from({ length: Math.round(90 * c.k) }, () => ({ x: Math.random(), y: rand(0.03, 0.97), vx: 0, vy: 0, size: rand(0.003, 0.008) }));
      c.moment("timestop");
    }
  };
  return {
    st,
    get drops() { return drops; },
    setOn(c, on) { if (st.on !== on) set(c, on, { x: 0.5, y: 0.5 }); },
    gesture(c) {
      if (c.always) return;
      const at = clap.update(c.tracks, c.t, c.aspect);
      if (at) set(c, !st.on, at);
    },
    frame(c, dt) {
      if (c.always && !st.on) this.setOn(c, true);
      const tips = c.tracks.flatMap((x) => x.info.tips);
      drops = drops.filter((d) => {
        if (st.on) {
          for (const p of tips) {
            const dx = (d.x - p.x) * c.aspect, dy = d.y - p.y, dd = Math.hypot(dx, dy);
            if (dd < 0.035 && dd > 1e-4) { d.vx += ((dx / dd) * 0.25) / c.aspect; d.vy += (dy / dd) * 0.25; }
          }
          d.vx *= Math.exp(-3 * dt); d.vy *= Math.exp(-3 * dt);
        } else d.vy += 2.5 * dt;                                       // time runs again: they fall
        d.x += d.vx * dt; d.y += d.vy * dt;
        c.B.push(d.x, d.y, d.x - d.vx * 0.02, d.y - d.vy * 0.02 - (st.on ? 0 : 0.01), [0.75, 0.88, 1], 0.8, d.size, KIND.LINE);
        return d.y < 1.05;
      });
      st.level = approach(st.level, st.on ? 1 : 0, 6, dt);
      c.world.frozen = st.level;
      c.vignette(0.3 * st.level);
    },
  };
}

// ---------------------------------------------------------------- speedster
function speed() {
  let echo = 0;
  return {
    frame(c, dt) {
      const fast = c.tracks.reduce((m, x) => Math.max(m, x.speed), 0);
      echo = approach(echo, clamp01(0.45 + fast * 0.35), 4, dt);
      for (const tr of c.tracks) {
        if (tr.speed < 0.9) continue;
        for (let i = 0; i < 40 * c.k * dt * tr.speed; i++) {
          const p = tr.info.tips[Math.floor(Math.random() * 5)];
          c.particles.emit({ x: p.x, y: p.y, vx: -tr.vx * 0.4, vy: -tr.vy * 0.4, life: 0.35, size: 0.004, color: c.hot, kind: KIND.SPARK, drag: 3 });
        }
        c.light(tr.info.palm.x, tr.info.palm.y, 0.14, 0.2 * Math.min(2, tr.speed), c.color);
      }
      c.world.echo = echo;
    },
  };
}

// ---------------------------------------------------------------- clones
function clones() {
  const hold = new SignHold(0.9);
  const st = { on: false, amt: 0 };
  return {
    st,
    setOn(c, on) {
      if (st.on === on) return;
      st.on = on;
      c.sfx.puff();
      const cx = c.body?.cx ?? 0.5, cy = c.body?.cy ?? 0.55;
      const offs = c.s.cloneCount === "4" ? [-0.52, -0.26, 0.26, 0.52] : [-0.26, 0.26];
      for (const off of offs) c.burst(cx + off, cy, 26, { color: [0.85, 0.85, 0.9], speed: 0.25, size: 0.03, life: 0.9, grav: -0.05, drag: 2 });
      if (on) c.moment("clones");
    },
    gesture(c) {
      if (c.always) return;
      const tr = c.tracks.find((x) => x.info.victory && x.speed < 0.5);
      const r = hold.update(tr && c.tracks.length === 1 ? "victory" : null, c.t);
      if (tr && r.sign) c.holdUI = { x: tr.info.palm.x, y: tr.info.palm.y, p: r.progress, label: st.on ? "Dismiss" : "Clones!" };
      if (r.fire) this.setOn(c, !st.on);
    },
    frame(c, dt) {
      if (c.always && !st.on) this.setOn(c, true);
      st.amt = approach(st.amt, st.on ? 1 : 0, 3, dt);
      c.world.clones = c.s.cloneCount === "4" ? 4 : 2;
      c.world.cloneAmt = st.amt;
    },
  };
}

// ---------------------------------------------------------------- laser vision
function eyes() {
  const st = { on: false, level: 0 };
  let loop = null, lastScorch = null;
  return {
    st,
    gesture(c) {
      const f = c.faces[0];
      const open = f && c.facesFresh ? f.open ?? 0 : 0;
      st.on = st.on ? open > 0.14 : open > 0.24;   // hysteresis
    },
    frame(c, dt) {
      const f = c.faces[0];
      st.level = approach(st.level, st.on ? 1 : 0, st.on ? 18 : 10, dt);
      if (!f || st.level < 0.02) { if (loop) { loop.stop(); loop = null; } return; }
      const { B, aspect, k, color: col, hot, t } = c;
      const aim = faceAim(f, aspect);
      const dx = aim.yaw * 1.8, dy = aim.pitch * 1.8, len = Math.hypot(dx, dy);
      const L = st.level;
      for (const e of aim.eyes) {
        c.light(e.x, e.y, f.r * 1.2, 0.8 * L, col);                    // your face lit by your own eyes
        if (len < 0.35) {
          // looking at the camera: the beam comes at you
          const r = f.r * (0.18 + 0.1 * Math.sin(t * 40)) * L;
          B.push(e.x, e.y, e.x, e.y, mixColor(col, WHITE, 0.3), L, r, KIND.ORB, t * 9);
          B.push(e.x, e.y, e.x, e.y, hot, L * 0.6, r * (1.5 + ((t * 3) % 1) * 2), KIND.RING, 0.006, t);
          c.flash(0.12 * L);
        } else {
          // the beams hit the wall behind: sweeping your head burns a trail on it
          const end = along(e, { x: dx / len / aspect, y: dy / len }, 0.55);
          const w = f.r * 0.12 * L;
          B.push(e.x, e.y, end.x, end.y, col, 1, w, KIND.BEAM, t * 9);
          B.push(e.x, e.y, e.x, e.y, mixColor(col, WHITE, 0.5), L, w * 1.8, KIND.ORB, t * 7);
          B.push(end.x, end.y, end.x, end.y, hot, L, w * 2.5, KIND.ORB, t * 11);
          c.light(end.x, end.y, 0.12, 0.9 * L, col);
          c.heat(end.x, end.y, 0.06, 1);
          for (let i = 0; i < 3 * k; i++) c.particles.emit({ x: end.x, y: end.y, vx: rand(-0.6, 0.6) / aspect, vy: rand(-0.9, 0.2), life: 0.45, size: 0.005, color: hot, kind: KIND.SPARK, grav: 1.6 });
          if (!end.edge && L > 0.8 && (!lastScorch || Math.hypot((end.x - lastScorch.x) * aspect, end.y - lastScorch.y) > 0.018)) {
            c.scorch(end.x, end.y, 0.022);
            lastScorch = { x: end.x, y: end.y };
          }
          c.hitSegment(e.x, e.y, end.x, end.y, w);
        }
      }
      loop ??= c.sfx.loop("laser");
      loop?.set(L, 0.5);
    },
    stop() { loop?.stop(); loop = null; },
  };
}

// ---------------------------------------------------------------- portal
function portal() {
  const circle = new CircleStroke();
  const portals = [];
  return {
    portals,
    gesture(c) {
      const pointer = c.tracks.find((x) => x.info.point);
      const ring = circle.update(pointer ? pointer.info.tip : null, c.t, c.aspect);
      if (ring) {
        if (portals.length >= 2) portals.shift();
        portals.push({ x: ring.x, y: ring.y, r: Math.max(0.08, ring.r * 1.1), t0: c.t, open: 0, closing: false });
        c.sfx.portal();
        c.burst(ring.x, ring.y, 40, { color: mixColor(c.color, [1, 0.7, 0.3], 0.5), speed: 0.5, size: 0.008, life: 0.7, kind: KIND.SPARK });
        c.moment("portal");
      }
      for (const tr of c.tracks) {
        const inside = portals.find((p) => !p.closing && Math.hypot((p.x - tr.info.palm.x) * c.aspect, p.y - tr.info.palm.y) < p.r);
        if (c.trig("fistIn", tr, 0.5).update(!!inside && tr.info.fist, c.t)) { inside.closing = true; c.sfx.close(); }
      }
    },
    frame(c, dt) {
      const { B, aspect, k, hot, t } = c;
      const pts = circle.points;
      for (let i = 1; i < pts.length; i++) B.push(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, hot, 0.25 + 0.6 * (i / pts.length), 0.004, KIND.LINE);
      for (let i = portals.length - 1; i >= 0; i--) {
        const p = portals[i];
        if (t - p.t0 > 30) p.closing = true;
        p.open = approach(p.open, p.closing ? 0 : 1, p.closing ? 8 : 3, dt);
        if (p.closing && p.open < 0.02) { portals.splice(i, 1); continue; }
        const R = p.r * p.open, rim = mixColor(c.color, [1, 0.62, 0.25], 0.55);
        B.push(p.x, p.y, p.x, p.y, rim, 1, R, KIND.RING, 0.008 + 0.006 * k, p.t0 * 13);
        c.light(p.x, p.y, R * 2, 0.7 * p.open, mixColor(c.color, [0.5, 0.2, 1], 0.5));
        for (let j = 0; j < 70 * k * dt * p.open; j++) {
          const a = Math.random() * Math.PI * 2, px = p.x + (Math.cos(a) * R) / aspect, py = p.y + Math.sin(a) * R;
          const v = rand(0.25, 0.6);
          c.particles.emit({ x: px, y: py, vx: (-Math.sin(a) * v) / aspect, vy: Math.cos(a) * v + 0.15, life: rand(0.25, 0.55), size: 0.004, color: rim, kind: KIND.SPARK, grav: 0.8, drag: 1 });
        }
        c.world.portals.push({ x: p.x, y: p.y, r: p.r, s: p.open });
      }
    },
  };
}

// ---------------------------------------------------------------- power up
function aura() {
  const st = { level: 0, charging: false };
  let loop = null, full = false;
  return {
    st,
    gesture(c) { st.charging = c.tracks.length === 2 && c.tracks.every((x) => x.info.fist); },
    frame(c, dt) {
      const target = c.always ? Math.max(0.55, st.charging ? 1 : 0) : st.charging ? 1 : 0;
      st.level = approach(st.level, target, st.charging ? 0.9 : 0.5, dt);
      const L = st.level;
      if (L > 0.92 && !full) { full = true; c.wave(c.body?.cx ?? 0.5, c.body?.cy ?? 0.6, 1.2, 1); c.sfx.shock(); c.moment("powerup"); }
      if (L < 0.6) full = false;
      if (L > 0.05) {
        const cx = c.body?.cx ?? 0.5, w = c.body ? c.body.right - c.body.left : 0.3;
        for (let i = 0; i < 60 * c.k * dt * L; i++) {
          c.particles.emit({ x: cx + rand(-0.6, 0.6) * w, y: rand(c.body?.top ?? 0.45, 1), vx: rand(-0.03, 0.03), vy: -rand(0.2, 0.6) * L, life: rand(0.5, 1.1), size: rand(0.003, 0.007), color: c.hot, kind: KIND.SPARK, drag: 0.5 });
        }
        if (c.body) {
          c.light(cx, c.body.cy, Math.max(0.25, w), 0.9 * L, c.color);
          c.heat(cx, c.body.top, w * 0.8, 1.2 * L);
        }
        if (st.charging) { c.shake(0.004 * L); c.aberr(0.006 * L); }
        loop ??= c.sfx.loop("aura");
        loop?.set(0.3 + 0.7 * L, L);
      } else if (loop) { loop.stop(); loop = null; }
      c.world.aura = L * (0.7 + 0.3 * c.k);
      c.vignette(0.25 * L);
    },
    stop() { loop?.stop(); loop = null; },
  };
}

/** id → factory (a fresh instance per selection, so no state leaks between powers). */
export const ABILITIES = { wave, lightning, fire, force, shield, frost, warp, size, teleport, invisible, freeze, speed, clones, eyes, portal, aura };
