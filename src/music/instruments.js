// Gesture → music event detection (pure, unit-tested). All positions are in
// normalised display space (x right, y down, mirrored for the selfie camera).
//
// Landmarks: 0 wrist, 4 thumb tip, 8 index tip, 12 middle tip, 16 ring tip, 20 pinky tip, 9 middle knuckle.

export const TIPS = [8, 12, 16, 20];

const dist = (a, b, aspect = 1) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
const handSize = (lm, aspect) => Math.max(1e-3, dist(lm[0], lm[9], aspect));

/** Hands sorted left → right on screen (side 0 = left hand on screen). */
export function sortHands(hands) {
  return [...hands].sort((a, b) => a[0].x - b[0].x);
}

/**
 * Thumb–finger pinches as piano keys. 4 fingers per hand; the left hand on screen
 * plays keys 0–3, the right hand keys 4–7. Hysteresis (press below `on`, release
 * above `off`, as fractions of the hand size) stops keys from chattering.
 */
export class PinchKeys {
  constructor({ on = 0.3, off = 0.42 } = {}) {
    this.on = on;
    this.off = off;
    this.down = new Set();
  }

  /** @returns {{pressed: number[], released: number[], down: Set<number>}} */
  update(hands, aspect = 1) {
    const pressed = [], released = [], seen = new Set();
    sortHands(hands).slice(0, 2).forEach((lm, side) => {
      const size = handSize(lm, aspect);
      TIPS.forEach((tip, f) => {
        const key = side * 4 + f;
        seen.add(key);
        const d = dist(lm[4], lm[tip], aspect) / size;
        if (!this.down.has(key) && d < this.on) { this.down.add(key); pressed.push(key); }
        else if (this.down.has(key) && d > this.off) { this.down.delete(key); released.push(key); }
      });
    });
    // a hand that left the picture releases its keys
    for (const key of [...this.down]) if (!seen.has(key)) { this.down.delete(key); released.push(key); }
    return { pressed, released, down: this.down };
  }

  reset() { this.down.clear(); }
}

/** Evenly spaced vertical strings across the picture. */
export function stringPositions(count, from = 0.1, to = 0.9) {
  return Array.from({ length: count }, (_, i) => from + ((to - from) * (i + 0.5)) / count);
}

/**
 * Air harp: a fingertip crossing a string between two frames plucks it.
 * Velocity comes from the fingertip's horizontal speed (units / s).
 */
export class StringCrossing {
  constructor(xs) { this.xs = xs; this.prev = new Map(); }

  /**
   * @param {{id: string, x: number, y: number}[]} tips
   * @param {number} dt  seconds since the previous update
   * @returns {{string: number, velocity: number, y: number}[]}
   */
  update(tips, dt) {
    const plucks = [], seen = new Set();
    for (const t of tips) {
      seen.add(t.id);
      const p = this.prev.get(t.id);
      if (p !== undefined && dt > 0) {
        const lo = Math.min(p, t.x), hi = Math.max(p, t.x);
        const speed = Math.abs(t.x - p) / dt;
        this.xs.forEach((x, string) => {
          if (x > lo && x <= hi) plucks.push({ string, velocity: Math.min(1, 0.25 + speed / 2.5), y: t.y });
        });
      }
      this.prev.set(t.id, t.x);
    }
    for (const id of [...this.prev.keys()]) if (!seen.has(id)) this.prev.delete(id);
    return plucks;
  }

  reset() { this.prev.clear(); }
}

/** 6 drum pads in two rows across the lower part of the picture. */
export function drumPads() {
  const names = ["hat", "snare", "crash", "kick", "clap", "tom"];
  const w = 0.24, h = 0.2, gap = 0.04, x0 = (1 - (3 * w + 2 * gap)) / 2;
  return names.map((name, i) => ({
    name,
    x: x0 + (i % 3) * (w + gap),
    y: i < 3 ? 0.42 : 0.68,
    w,
    h,
  }));
}

/**
 * Air drums: a fingertip entering a pad while moving DOWN fast enough hits it.
 * The pad re-arms once the fingertip has left it.
 */
export class PadHits {
  constructor(pads, { minSpeed = 0.35 } = {}) {
    this.pads = pads;
    this.minSpeed = minSpeed;
    this.prev = new Map();     // id → {y}
    this.inside = new Map();   // id → pad index the tip is in
  }

  /** @returns {{pad: number, velocity: number}[]} */
  update(tips, dt) {
    const hits = [], seen = new Set();
    for (const t of tips) {
      seen.add(t.id);
      const p = this.prev.get(t.id);
      const vy = p && dt > 0 ? (t.y - p.y) / dt : 0;
      const pad = this.pads.findIndex((r) => t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h);
      const was = this.inside.get(t.id) ?? -1;
      if (pad >= 0 && pad !== was && vy > this.minSpeed) hits.push({ pad, velocity: Math.min(1, 0.3 + vy / 3) });
      if (pad >= 0) this.inside.set(t.id, pad);
      else this.inside.delete(t.id);
      this.prev.set(t.id, { y: t.y });
    }
    for (const id of [...this.prev.keys()]) if (!seen.has(id)) { this.prev.delete(id); this.inside.delete(id); }
    return hits;
  }

  reset() { this.prev.clear(); this.inside.clear(); }
}

/**
 * Theremin: the RIGHT hand on screen sets the pitch (index fingertip height),
 * the LEFT hand the volume (higher = louder). One hand → pitch only, fixed volume.
 * @returns {{active: boolean, pitch: number, volume: number, x: number, y: number}}
 */
export function thereminControl(hands) {
  if (!hands.length) return { active: false, pitch: 0, volume: 0, x: 0, y: 0 };
  const sorted = sortHands(hands);
  const pitchHand = sorted[sorted.length - 1];
  const tip = pitchHand[8];
  const volume = sorted.length > 1 ? Math.max(0, Math.min(1, (0.95 - sorted[0][8].y) / 0.75)) : 0.75;
  return { active: true, pitch: Math.max(0, Math.min(1, (0.92 - tip.y) / 0.84)), volume, x: tip.x, y: tip.y };
}

/** Fingertips of all visible hands as tracked points with stable ids. */
export function fingertips(hands, which = TIPS) {
  const out = [];
  sortHands(hands).slice(0, 2).forEach((lm, side) => {
    for (const i of which) out.push({ id: `${side}:${i}`, x: lm[i].x, y: lm[i].y });
  });
  return out;
}
