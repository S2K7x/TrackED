import { test } from "node:test";
import assert from "node:assert/strict";
import { POWERS, POWER_IDS, powerWants, powerById, POWER_GUIDE } from "../src/powers/catalog.js";
import { handInfo, HandTracks, EnergyCharge, ClapDetector, CircleStroke, detectCircle, Trigger, faceAim } from "../src/powers/gestures.js";
import { bolt, makeRng, rayToEdge } from "../src/powers/lightning.js";
import { Particles, GlowBatch, KIND, STRIDE } from "../src/powers/particles.js";
import { Targets, segDist } from "../src/powers/targets.js";
import { MaskSmoother } from "../src/temporal.js";
import { summarizeFace, mirrorFace } from "../src/faces.js";
import { OPTIONS, POWER_TABS, DEFAULTS, PANEL_GROUPS } from "../src/options.js";

// ---------- synthetic hands (display space, y down) ----------
// An upright hand centred on (cx, cy): wrist at the bottom, fingers up.
function hand(cx, cy, { s = 0.1, fingers = 4, thumb = true, pinch = false } = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[0] = { x: cx, y: cy + s };
  const cols = [-0.3, -0.1, 0.1, 0.3];
  const finger = (base, i, up) => {
    const x = cx + cols[i] * s;
    lm[base] = { x, y: cy };                                    // knuckle
    if (up) { lm[base + 1] = { x, y: cy - 0.35 * s }; lm[base + 2] = { x, y: cy - 0.6 * s }; lm[base + 3] = { x, y: cy - 0.85 * s }; }
    else { lm[base + 1] = { x, y: cy - 0.3 * s }; lm[base + 2] = { x: x + 0.01 * s, y: cy - 0.1 * s }; lm[base + 3] = { x, y: cy + 0.1 * s }; }
  };
  [5, 9, 13, 17].forEach((b, i) => finger(b, i, i < fingers));
  lm[1] = { x: cx - 0.35 * s, y: cy + 0.7 * s };
  lm[2] = { x: cx - 0.55 * s, y: cy + 0.45 * s };
  if (thumb) { lm[3] = { x: cx - 0.75 * s, y: cy + 0.2 * s }; lm[4] = { x: cx - 0.95 * s, y: cy - 0.05 * s }; }
  else { lm[3] = { x: cx - 0.4 * s, y: cy + 0.3 * s }; lm[4] = { x: cx - 0.2 * s, y: cy + 0.2 * s }; }
  if (pinch) lm[4] = { ...lm[8] };
  return lm;
}

test("catalog: every power is complete and the options match it", () => {
  assert.equal(new Set(POWER_IDS).size, POWERS.length);
  for (const p of POWERS) {
    assert.ok(p.label && p.icon && p.tile && p.hint && p.how.length >= 2, p.id);
    for (const n of p.needs) assert.ok(["person", "face", "plate", "history"].includes(n), `${p.id}: ${n}`);
    if (p.needs.includes("plate") || p.needs.includes("history")) assert.ok(p.needs.includes("person"), `${p.id} needs the mask`);
  }
  assert.deepEqual(OPTIONS.power.map((o) => o.value), POWER_IDS);
  assert.deepEqual(powerWants("invisible"), { person: true, face: false });
  assert.deepEqual(powerWants("eyes"), { person: false, face: true });
  assert.deepEqual(powerWants("wave"), { person: false, face: false });
  assert.equal(powerById("nope").id, POWERS[0].id);
  assert.equal(POWER_GUIDE.sections.length, POWERS.length + 1);
  // no trademarked move names
  const text = JSON.stringify(POWERS).toLowerCase();
  for (const word of ["kamehameha", "hadouken", "rasengan", "chidori", "jutsu"]) assert.ok(!text.includes(word), word);
});

test("power tabs, settings and defaults are valid", () => {
  for (const t of POWER_TABS) for (const g of t.groups) assert.ok(OPTIONS[g] || PANEL_GROUPS.includes(g), g);
  for (const k of ["power", "intensity", "cloak", "cloneCount", "activation", "training", "powerSound", "shake"]) {
    assert.ok(OPTIONS[k].some((o) => o.value === DEFAULTS[k]), k);
  }
  assert.ok(OPTIONS.mode.some((o) => o.value === "powers"));
});

test("handInfo: open hand, fist, pinch, pointing, victory", () => {
  const open = handInfo(hand(0.5, 0.5), 1);
  assert.ok(open.open && !open.fist && !open.pinch);
  assert.equal(open.fingers, 4);
  assert.ok(Math.abs(open.size - Math.hypot(0.01, 0.1)) < 1e-9, "wrist → middle knuckle");
  assert.ok(open.dir.y < -0.9, "index points up");
  const fist = handInfo(hand(0.5, 0.5, { fingers: 0, thumb: false }), 1);
  assert.ok(fist.fist && !fist.open);
  assert.ok(handInfo(hand(0.5, 0.5, { pinch: true }), 1).pinch);
  assert.ok(handInfo(hand(0.5, 0.5, { fingers: 1, thumb: false }), 1).point);
  assert.ok(handInfo(hand(0.5, 0.5, { fingers: 2, thumb: false }), 1).victory);
});

test("HandTracks: velocity, identity and growth (push towards the camera)", () => {
  const tr = new HandTracks();
  tr.update([hand(0.3, 0.5)], 0, 1);
  const [a] = tr.update([hand(0.4, 0.5)], 0.1, 1);
  assert.ok(Math.abs(a.vx - 1) < 1e-6, String(a.vx));
  assert.ok(Math.abs(a.speed - 1) < 1e-6);
  const id = a.id;
  assert.equal(tr.update([hand(0.42, 0.5)], 0.15, 1)[0].id, id);
  // a far jump is a new hand
  assert.notEqual(tr.update([hand(0.95, 0.5)], 0.2, 1)[0].id, id);
  const g = new HandTracks();
  g.update([hand(0.5, 0.5, { s: 0.1 })], 0, 1);
  assert.ok(g.update([hand(0.5, 0.5, { s: 0.13 })], 0.15, 1)[0].growth > 0.25);
});

function feedCharge(ec, tracker, poses, t0 = 0, dt = 1 / 30) {
  let out = {}, t = t0;
  for (const p of poses) { out = ec.update(tracker.update(p, t, 1), t, dt, 1); t += dt; if (out.event) return { ...out, t }; }
  return { ...out, t };
}

test("EnergyCharge: charge, then throw sideways or blast at the camera", () => {
  // hold the ball for 1.5 s, then pull the hands apart without moving: blast at the camera
  let ec = new EnergyCharge(), tr = new HandTracks();
  const held = Array.from({ length: 45 }, () => [hand(0.45, 0.5), hand(0.55, 0.5)]);
  const apart = Array.from({ length: 10 }, () => [hand(0.1, 0.5), hand(0.9, 0.5)]);
  let r = feedCharge(ec, tr, held);
  assert.equal(r.event, undefined);
  assert.ok(ec.charging && ec.charge > 0.8, String(ec.charge));
  r = feedCharge(ec, tr, apart, r.t);
  assert.equal(r.event, "fire");
  assert.ok(r.fire.toCamera);
  assert.ok(Math.abs(r.fire.x - 0.5) < 0.01);

  // throw: the held ball moves right quickly before the hands separate
  ec = new EnergyCharge(); tr = new HandTracks();
  const moving = Array.from({ length: 40 }, (_, i) => { const x = 0.3 + (i > 30 ? (i - 30) * 0.03 : 0); return [hand(x - 0.05, 0.5), hand(x + 0.05, 0.5)]; });
  r = feedCharge(ec, tr, [...moving, ...apart]);
  assert.equal(r.event, "fire");
  assert.ok(!r.fire.toCamera && r.fire.dx > 0.9, JSON.stringify(r.fire));

  // too short: fizzle; fists never charge
  ec = new EnergyCharge(); tr = new HandTracks();
  r = feedCharge(ec, tr, [...held.slice(0, 4), ...apart]);
  assert.equal(r.event, "fizzle");
  ec = new EnergyCharge(); tr = new HandTracks();
  feedCharge(ec, tr, Array.from({ length: 20 }, () => [hand(0.45, 0.5, { fingers: 0, thumb: false }), hand(0.55, 0.5, { fingers: 0, thumb: false })]));
  assert.ok(!ec.charging);
});

test("EnergyCharge: one missed frame doesn't fire", () => {
  const ec = new EnergyCharge(), tr = new HandTracks();
  const held = Array.from({ length: 30 }, () => [hand(0.45, 0.5), hand(0.55, 0.5)]);
  const r = feedCharge(ec, tr, [...held, [hand(0.45, 0.5)], ...held]);
  assert.equal(r.event, undefined);
  assert.ok(ec.charging);
});

test("ClapDetector: fast clap fires once, slow approach doesn't", () => {
  const c = new ClapDetector(), tr = new HandTracks();
  let fired = 0;
  const seq = [0.1, 0.2, 0.3, 0.4, 0.47, 0.47, 0.47];   // left hand x; right mirrors it
  seq.forEach((x, i) => { if (c.update(tr.update([hand(x, 0.5), hand(1 - x, 0.5)], i / 30, 1), i / 30, 1)) fired++; });
  assert.equal(fired, 1);
  const slow = new ClapDetector(), tr2 = new HandTracks();
  let f2 = 0;
  for (let i = 0; i <= 120; i++) { const x = 0.1 + (0.37 * i) / 120; if (slow.update(tr2.update([hand(x, 0.5), hand(1 - x, 0.5)], i / 30, 1), i / 30, 1)) f2++; }
  assert.equal(f2, 0);
});

test("CircleStroke: a drawn circle opens a portal, a line or a dot doesn't", () => {
  const cs = new CircleStroke();
  let found = null;
  for (let i = 0; i <= 40 && !found; i++) {
    const a = (i / 40) * Math.PI * 2;
    found = cs.update({ x: 0.5 + 0.15 * Math.cos(a), y: 0.5 + 0.15 * Math.sin(a) }, i / 30, 1);
  }
  assert.ok(found, "circle found");
  assert.ok(Math.abs(found.x - 0.5) < 0.03 && Math.abs(found.y - 0.5) < 0.03 && Math.abs(found.r - 0.15) < 0.03, JSON.stringify(found));
  const line = Array.from({ length: 30 }, (_, i) => ({ x: 0.2 + i * 0.02, y: 0.5 }));
  assert.equal(detectCircle(line, 1), null);
  const dot = Array.from({ length: 30 }, (_, i) => ({ x: 0.5 + 0.001 * Math.cos(i), y: 0.5 + 0.001 * Math.sin(i) }));
  assert.equal(detectCircle(dot, 1), null);
  const half = Array.from({ length: 30 }, (_, i) => ({ x: 0.5 + 0.15 * Math.cos((i / 30) * Math.PI), y: 0.5 + 0.15 * Math.sin((i / 30) * Math.PI) }));
  assert.equal(detectCircle(half, 1), null);
  assert.equal(cs.update(null, 2, 1), null);
  assert.equal(cs.points.length, 0);
});

test("Trigger: rising edge with cooldown", () => {
  const tg = new Trigger(0.5);
  assert.equal(tg.update(true, 0), true);
  assert.equal(tg.update(true, 0.1), false);
  assert.equal(tg.update(false, 0.2), false);
  assert.equal(tg.update(true, 0.3), false);      // cooling down
  tg.update(false, 0.6);
  assert.equal(tg.update(true, 0.7), true);
});

test("faces: mouth opening and gaze", () => {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  lm[234] = { x: 0.4, y: 0.5 }; lm[454] = { x: 0.6, y: 0.5 };
  lm[468] = { x: 0.45, y: 0.45 }; lm[473] = { x: 0.55, y: 0.45 };
  lm[1] = { x: 0.5, y: 0.51 };
  lm[13] = { x: 0.5, y: 0.55 }; lm[14] = { x: 0.5, y: 0.59 };
  const f = summarizeFace(lm, 1);
  assert.ok(Math.abs(f.open - 0.4) < 1e-6, String(f.open));
  assert.equal(mirrorFace(f).open, f.open);
  const aim = faceAim(f, 1);
  assert.ok(Math.abs(aim.yaw) < 1e-6 && Math.abs(aim.pitch) < 1e-6, JSON.stringify(aim));
  lm[1] = { x: 0.53, y: 0.51 };
  assert.ok(faceAim(summarizeFace(lm, 1), 1).yaw > 0.25);
});

test("lightning: connected bolt from a to b, deterministic, with branches", () => {
  const a = { x: 0.1, y: 0.2 }, b = { x: 0.8, y: 0.7 };
  const segs = bolt(a, b, { rng: makeRng(3), depth: 6, branch: 0.3, aspect: 16 / 9 });
  const main = segs.filter((s) => s.w === 1);
  assert.equal(main.length, 64);
  assert.ok(Math.abs(main[0].ax - a.x) < 1e-9 && Math.abs(main[0].ay - a.y) < 1e-9);
  assert.ok(Math.abs(main[63].bx - b.x) < 1e-9 && Math.abs(main[63].by - b.y) < 1e-9);
  for (let i = 1; i < main.length; i++) assert.ok(Math.abs(main[i].ax - main[i - 1].bx) < 1e-12);
  assert.ok(segs.some((s) => s.w < 1), "has branches");
  assert.deepEqual(bolt(a, b, { rng: makeRng(3), depth: 6, branch: 0.3, aspect: 16 / 9 }), segs);
  const r = makeRng(9), xs = Array.from({ length: 1000 }, r);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.ok(Math.abs(xs.reduce((s, x) => s + x, 0) / 1000 - 0.5) < 0.05);
});

test("rayToEdge", () => {
  assert.deepEqual(rayToEdge({ x: 0.5, y: 0.5 }, { x: 1, y: 0 }), { x: 1, y: 0.5, t: 0.5 });
  const e = rayToEdge({ x: 0.5, y: 0.5 }, { x: -1, y: -1 });
  assert.ok(Math.abs(e.x) < 1e-9 && Math.abs(e.y) < 1e-9);
  assert.equal(rayToEdge({ x: 0.5, y: 0.5 }, { x: 0, y: 0 }).t, 0);
});

test("particles: physics, death, swap-remove and glow output", () => {
  const p = new Particles(3);
  assert.ok(p.emit({ x: 0, y: 0, vx: 1, vy: 0, life: 1 }));
  p.emit({ x: 0, y: 0, vy: 0, life: 0.1, grav: -1 });
  p.emit({ x: 0.5, y: 0.5, life: 2, kind: KIND.SPARK, vx: 1 });
  assert.equal(p.emit({ x: 0, y: 0 }), false, "pool full");
  p.update(0.5);
  assert.equal(p.n, 2);
  assert.ok(Math.abs(p.x[0] - 0.5) < 1e-6);
  const b = new GlowBatch(10);
  p.write(b);
  assert.equal(b.count, 2);
  assert.equal(b.view.length, 2 * STRIDE);
  assert.equal(b.data[STRIDE + 9], KIND.LINE, "sparks stretch into lines");
  const fl = new Particles(1), fb = new GlowBatch(2);
  fl.emit({ x: 0.5, y: 0.5, life: 1, size: 0.02, kind: KIND.FLAME });
  fl.write(fb);
  assert.equal(fb.data[9], KIND.DOT);
  assert.ok(fb.data[3] < fb.data[1], "flames are stretched upwards");
  const full = new GlowBatch(1);
  assert.ok(full.push(0, 0, 0, 0, [1, 1, 1], 1, 0.01, KIND.DOT));
  assert.equal(full.push(0, 0, 0, 0, [1, 1, 1], 1, 0.01, KIND.DOT), false);
});

test("targets: spawn away from the middle, hits, combo, best", () => {
  const T = new Targets(makeRng(5), { max: 3 });
  for (let i = 0; i < 100; i++) T.update(0.05, i * 0.05);
  assert.equal(T.list.length, 3);
  for (const g of T.list) assert.ok(g.x < 0.4 || g.x > 0.6, String(g.x));
  const [g1, g2] = T.list;
  assert.equal(T.hitCircle(g1.x, g1.y, 0.01, 10).length, 1);
  assert.equal(T.score, 10);
  assert.equal(T.hitSegment(g2.x - 0.1, g2.y, g2.x + 0.1, g2.y, 0.01, 11).length, 1);
  assert.equal(T.combo, 2);
  assert.equal(T.score, 30);
  assert.equal(T.best, 30);
  T.update(0.01, 20);
  assert.equal(T.combo, 0, "combo expires");
  assert.equal(T.hitRing(0, 0, 5, 0.01, 21).length, 0);
  assert.ok(Math.abs(segDist(0.5, 0.5, 0, 0, 1, 0) - 0.5) < 1e-9);
});

test("MaskSmoother: fast attack, slower release, transferable output", () => {
  const m = new MaskSmoother({ attack: 0.75, release: 0.5 });
  assert.deepEqual([...m.apply(new Uint8Array([0, 200]))], [0, 200]);
  const out = m.apply(new Uint8Array([200, 0]));
  assert.deepEqual([...out], [150, 100]);
  const again = m.apply(new Uint8Array([200, 0]));
  assert.deepEqual([...again], [188, 50]);
  assert.notEqual(again.buffer, m.prev.buffer, "history is a separate copy");
});
