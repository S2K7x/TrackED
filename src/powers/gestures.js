// Gesture detection for the superpowers (pure, unit-tested). Positions are in
// normalised display space (x right, y down, mirrored for the selfie camera).
// Distances and speeds are aspect-corrected, in units of the picture height
// (speeds: heights per second), so thresholds hold on portrait and landscape.
//
// Landmarks: 0 wrist; thumb 1-4; index 5-8; middle 9-12; ring 13-16; pinky 17-20.

import { fingerExtended, thumbExtended } from "../gestures.js";

const FINGERS = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const dist = (a, b, aspect) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/**
 * Everything the powers read from one hand.
 * @returns {{palm, size, fingers, thumb, open, fist, pinch, point, tip, thumbTip, tips, dir}}
 *   size = wrist → middle knuckle (height units); dir = index finger direction (display units, unit length in aspect space)
 */
export function handInfo(lm, aspect = 1) {
  const ids = [0, 5, 9, 13, 17];
  const palm = { x: ids.reduce((s, i) => s + lm[i].x, 0) / 5, y: ids.reduce((s, i) => s + lm[i].y, 0) / 5 };
  const size = Math.max(1e-3, dist(lm[0], lm[9], aspect));
  const ext = FINGERS.map((f) => fingerExtended(lm, f, aspect));
  const fingers = ext.filter(Boolean).length;
  const thumb = thumbExtended(lm, aspect);
  // thumb on index tip, with the index NOT curled in (a fist's thumb also rests on the index)
  const pinch = dist(lm[4], lm[8], aspect) / size < 0.32 && dist(lm[0], lm[8], aspect) / size > 1.05;
  const reach = [8, 12, 16, 20].reduce((s, i) => s + dist(lm[0], lm[i], aspect), 0) / 4 / size;
  const dx = (lm[8].x - lm[5].x) * aspect, dy = lm[8].y - lm[5].y, dl = Math.hypot(dx, dy) || 1;
  return {
    palm, size, fingers, thumb, pinch,
    open: fingers >= 4,
    fist: fingers === 0 && !pinch && reach < 1.3,
    point: ext[0] && !ext[1] && !ext[2] && !ext[3],
    victory: ext[0] && ext[1] && !ext[2] && !ext[3],
    tip: lm[8], thumbTip: lm[4],
    tips: [4, 8, 12, 16, 20].map((i) => lm[i]),
    dir: { x: dx / dl / aspect, y: dy / dl },
  };
}

/**
 * Follows up to two hands between results (matched by nearest palm) and keeps a
 * short history per hand for velocities and "push towards the camera" (the hand
 * grows in the picture).
 */
export class HandTracks {
  constructor({ window = 0.25 } = {}) {
    this.window = window;
    this.tracks = [];
    this.nextId = 1;
  }

  reset() { this.tracks = []; }

  /** @returns {object[]} tracks sorted left → right: {id, info, vx, vy, speed, growth, age} */
  update(hands, t, aspect = 1) {
    const infos = hands.slice(0, 2).map((lm) => handInfo(lm, aspect));
    const prev = this.tracks;
    const used = new Set();
    const next = infos.map((info) => {
      let best = null, bd = Infinity;
      for (const tr of prev) {
        if (used.has(tr)) continue;
        const d = dist(tr.info.palm, info.palm, aspect);
        if (d < bd) { bd = d; best = tr; }
      }
      // a hand that jumped more than ~3 hand sizes is a new hand
      const tr = best && bd < Math.max(0.25, 3 * info.size) ? best : { id: this.nextId++, hist: [], born: t };
      used.add(tr);
      tr.info = info;
      tr.hist.push({ t, x: info.palm.x, y: info.palm.y, size: info.size });
      while (tr.hist.length > 2 && t - tr.hist[0].t > this.window) tr.hist.shift();
      const h0 = tr.hist[0], dt = t - h0.t;
      tr.vx = dt > 0.02 ? (info.palm.x - h0.x) / dt : 0;
      tr.vy = dt > 0.02 ? (info.palm.y - h0.y) / dt : 0;
      tr.speed = Math.hypot(tr.vx * aspect, tr.vy);
      tr.growth = dt > 0.06 ? info.size / h0.size - 1 : 0;   // +0.3 = 30 % bigger within the window
      tr.age = t - tr.born;
      return tr;
    });
    this.tracks = next.sort((a, b) => a.info.palm.x - b.info.palm.x);
    return this.tracks;
  }
}

/**
 * Energy wave: both hands held close together (not fists) charge a ball
 * between the palms. When the pose breaks, a charge above `min` fires:
 * sideways along the hands' recent motion when they were thrown, otherwise
 * straight at the camera.
 */
export class EnergyCharge {
  constructor({ full = 1.6, min = 0.25, grace = 0.15 } = {}) {
    Object.assign(this, { full, min, grace });
    this.reset();
  }

  reset() { this.charge = 0; this.charging = false; this.lost = 0; this.trail = []; this.center = null; this.radius = 0; }

  /** @returns {{event?: "fire"|"fizzle", fire?: object}} */
  update(tracks, t, dt, aspect = 1) {
    const [a, b] = tracks;
    let pose = false;
    if (a && b && !a.info.fist && !b.info.fist && a.info.fingers + b.info.fingers >= 3) {
      const gap = dist(a.info.palm, b.info.palm, aspect);
      const size = (a.info.size + b.info.size) / 2;
      pose = gap < (this.charging ? 2.4 : 1.9) * size;     // hysteresis: harder to start than to keep
      if (pose) {
        this.center = { x: (a.info.palm.x + b.info.palm.x) / 2, y: (a.info.palm.y + b.info.palm.y) / 2 };
        this.radius = Math.max(0.02, Math.min(gap * 0.5, size));
        this.trail.push({ t, ...this.center });
        while (this.trail.length > 2 && t - this.trail[0].t > 0.2) this.trail.shift();
      }
    }
    if (pose) {
      this.charging = true;
      this.lost = 0;
      this.charge = Math.min(1, this.charge + dt / this.full);
      return {};
    }
    if (!this.charging) return {};
    this.lost += dt;
    if (this.lost < this.grace) return {};            // a missed frame doesn't fire
    const charge = this.charge, c = this.center;
    const tr = this.trail, h0 = tr[0], h1 = tr[tr.length - 1];
    const span = h1 && h0 ? h1.t - h0.t : 0;
    const vx = span > 0.03 ? (h1.x - h0.x) / span : 0, vy = span > 0.03 ? (h1.y - h0.y) / span : 0;
    this.reset();
    if (charge < this.min) return { event: "fizzle", fire: { x: c.x, y: c.y, power: charge } };
    const speed = Math.hypot(vx * aspect, vy);
    const thrown = speed > 0.45;
    return {
      event: "fire",
      fire: { x: c.x, y: c.y, power: charge, toCamera: !thrown, dx: thrown ? (vx * aspect) / speed : 0, dy: thrown ? vy / speed : 0 },
    };
  }
}

/**
 * Clap: the two palms go from apart (> `apart` hand sizes) to touching
 * (< `touch`) within `within` seconds.
 */
export class ClapDetector {
  constructor({ apart = 2.4, touch = 1.15, within = 0.35, cooldown = 0.8 } = {}) {
    Object.assign(this, { apart, touch, within, cooldown });
    this.reset();
  }

  reset() { this.lastApart = -Infinity; this.lastClap = -Infinity; this.wasTouching = false; }

  /** @returns {{x, y}|null} where the hands met */
  update(tracks, t, aspect = 1) {
    const [a, b] = tracks;
    if (!a || !b) { this.wasTouching = false; return null; }
    const gap = dist(a.info.palm, b.info.palm, aspect) / ((a.info.size + b.info.size) / 2);
    if (gap > this.apart) this.lastApart = t;
    const touching = gap < this.touch;
    const clap = touching && !this.wasTouching && t - this.lastApart < this.within && t - this.lastClap > this.cooldown;
    this.wasTouching = touching;
    if (!clap) return null;
    this.lastClap = t;
    return { x: (a.info.palm.x + b.info.palm.x) / 2, y: (a.info.palm.y + b.info.palm.y) / 2 };
  }
}

/**
 * Air circle drawn with a fingertip: the stroke's points must sit at a roughly
 * constant distance from their centroid and sweep (almost) a full turn.
 */
export class CircleStroke {
  constructor({ maxAge = 1.8, minR = 0.05, maxR = 0.4, roundness = 0.32, turn = 0.85 } = {}) {
    Object.assign(this, { maxAge, minR, maxR, roundness, turn });
    this.points = [];
  }

  reset() { this.points = []; }

  /**
   * @param {{x, y}|null} p  fingertip while drawing (null = not drawing)
   * @returns {{x, y, r}|null} the circle (r in height units) when one is closed
   */
  update(p, t, aspect = 1) {
    if (!p) { this.points = []; return null; }
    const last = this.points[this.points.length - 1];
    if (!last || Math.hypot((p.x - last.x) * aspect, p.y - last.y) > 0.004) this.points.push({ x: p.x, y: p.y, t });
    while (this.points.length && t - this.points[0].t > this.maxAge) this.points.shift();
    const c = detectCircle(this.points, aspect, this);
    if (c) this.points = [];
    return c;
  }
}

/** @returns {{x, y, r}|null} */
export function detectCircle(points, aspect = 1, o = {}) {
  const { minR = 0.05, maxR = 0.4, roundness = 0.32, turn = 0.85 } = o;
  if (points.length < 10) return null;
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length; cy /= points.length;
  const rs = points.map((p) => Math.hypot((p.x - cx) * aspect, p.y - cy));
  const r = rs.reduce((s, x) => s + x, 0) / rs.length;
  if (r < minR || r > maxR) return null;
  const sd = Math.sqrt(rs.reduce((s, x) => s + (x - r) ** 2, 0) / rs.length);
  if (sd / r > roundness) return null;
  let sweep = 0;
  for (let i = 1; i < points.length; i++) {
    const a0 = Math.atan2(points[i - 1].y - cy, (points[i - 1].x - cx) * aspect);
    const a1 = Math.atan2(points[i].y - cy, (points[i].x - cx) * aspect);
    let d = a1 - a0;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    sweep += d;
  }
  return Math.abs(sweep) >= 2 * Math.PI * turn ? { x: cx, y: cy, r } : null;
}

/** Rising-edge trigger with a cooldown (pinch → strike, flick → throw…). */
export class Trigger {
  constructor(cooldown = 0.4) { this.cooldown = cooldown; this.was = false; this.last = -Infinity; }
  reset() { this.was = false; }
  update(on, t) {
    const fire = on && !this.was && t - this.last >= this.cooldown;
    this.was = on;
    if (fire) this.last = t;
    return fire;
  }
}

/** Mouth opening and gaze direction from the face anchors (display space). */
export function faceAim(face, aspect = 1) {
  const mx = (face.eyeL.x + face.eyeR.x) / 2, my = (face.eyeL.y + face.eyeR.y) / 2;
  const r = Math.max(1e-3, face.r);
  // the nose tip sits ~0.6 face half-widths below the eyes when looking straight ahead
  const yaw = ((face.nose.x - mx) * aspect) / r, pitch = (face.nose.y - my) / r - 0.6;
  return { open: face.open ?? 0, yaw, pitch, eyes: [face.eyeL, face.eyeR] };
}

/**
 * Where you are, from the soft person mask (camera space, 0..255): centre of
 * mass and bounding box, in DISPLAY space (mirrored when `mirror`). Sampled
 * on a coarse grid (every `step` pixels), so it costs a few thousand reads.
 * @returns {{cx, cy, left, right, top, bottom, area}|null} area = fraction of the picture
 */
export function maskStats(mask, mirror = true, step = 4) {
  const { data, width: W, height: H } = mask;
  let n = 0, sx = 0, sy = 0, x0 = 1, x1 = 0, y0 = 1, y1 = 0, total = 0;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      total++;
      if (data[y * W + x] < 128) continue;
      const u = (x + 0.5) / W, v = (y + 0.5) / H;
      n++; sx += u; sy += v;
      if (u < x0) x0 = u; if (u > x1) x1 = u;
      if (v < y0) y0 = v; if (v > y1) y1 = v;
    }
  }
  if (n < total * 0.01) return null;              // less than 1 % of the picture: nobody there
  const mx = (u) => (mirror ? 1 - u : u);
  return {
    cx: mx(sx / n), cy: sy / n,
    left: Math.min(mx(x0), mx(x1)), right: Math.max(mx(x0), mx(x1)),
    top: y0, bottom: y1, area: n / total,
  };
}

/**
 * Two-hand pinch zoom, like on a phone: while BOTH hands pinch, the scale is
 * the starting scale × (distance now / distance at the start).
 */
export class PinchZoom {
  constructor({ min = 0.35, max = 1.8 } = {}) { this.min = min; this.max = max; this.scale = 1; this.start = null; }
  reset() { this.scale = 1; this.start = null; }
  /** @returns {{active: boolean, scale: number}} */
  update(tracks, aspect = 1) {
    const [a, b] = tracks;
    if (!a || !b || !a.info.pinch || !b.info.pinch) { this.start = null; return { active: false, scale: this.scale }; }
    const pa = a.info.tip, pb = b.info.tip;
    const d = Math.max(0.02, Math.hypot((pa.x - pb.x) * aspect, pa.y - pb.y));
    if (!this.start) this.start = { d, scale: this.scale };
    this.scale = Math.max(this.min, Math.min(this.max, (this.start.scale * d) / this.start.d));
    return { active: true, scale: this.scale };
  }
}

/** Critically-under-damped spring (snap-back with a little wobble). Semi-implicit Euler. */
export class Spring {
  constructor({ stiffness = 90, damping = 9 } = {}) { this.k = stiffness; this.c = damping; this.x = 0; this.v = 0; }
  step(target, dt) {
    const h = Math.min(dt, 1 / 30);
    this.v += (this.k * (target - this.x) - this.c * this.v) * h;
    this.x += this.v * h;
    return this.x;
  }
  set(x) { this.x = x; this.v = 0; }
}
