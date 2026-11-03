// Procedural lightning (pure, unit-tested): recursive midpoint displacement
// with side branches. A straight segment is split at its middle, the middle is
// pushed sideways by a random amount proportional to the segment's length, and
// both halves are split again. Branches fork off some midpoints at 20–45°.
// Rendered as glowing line segments (wide halo + white core, additive).

/** Small fast seeded PRNG (mulberry32): same seed → same bolt (tests, flicker control). */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {{x, y}} a  start (display space)
 * @param {{x, y}} b  end
 * @param {{rng?: () => number, depth?: number, jag?: number, branch?: number, width?: number, aspect?: number}} o
 *   depth  = subdivision levels (2^depth segments on the main channel)
 *   jag    = sideways displacement as a fraction of the segment length
 *   branch = probability that a midpoint grows a side branch
 * @returns {{ax, ay, bx, by, w}[]} segments; w = relative width (1 = main channel)
 */
export function bolt(a, b, o = {}) {
  const { rng = Math.random, depth = 6, jag = 0.22, branch = 0.18, width = 1, aspect = 1 } = o;
  const out = [];
  // work in aspect-corrected space so the bolt isn't squashed on wide pictures
  const A = { x: a.x * aspect, y: a.y }, B = { x: b.x * aspect, y: b.y };
  const branches = [];
  let pts = [A, B];
  for (let level = 0; level < depth; level++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
      const off = (rng() - 0.5) * 2 * jag * len;
      const m = { x: (p.x + q.x) / 2 - (dy / (len || 1)) * off, y: (p.y + q.y) / 2 + (dx / (len || 1)) * off };
      next.push(m, q);
      if (width > 0.3 && level >= 1 && level <= depth - 2 && rng() < branch) {
        const ang = (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.45);
        const tx = q.x - m.x, ty = q.y - m.y, tl = Math.hypot(tx, ty) || 1;
        const remaining = Math.hypot(B.x - m.x, B.y - m.y);
        const L = remaining * (0.3 + rng() * 0.3);
        const c = Math.cos(ang), s = Math.sin(ang);
        const ex = m.x + ((tx * c - ty * s) / tl) * L, ey = m.y + ((tx * s + ty * c) / tl) * L;
        branches.push([{ x: m.x / aspect, y: m.y }, { x: ex / aspect, y: ey }]);
      }
    }
    pts = next;
  }
  for (let i = 1; i < pts.length; i++) {
    out.push({ ax: pts[i - 1].x / aspect, ay: pts[i - 1].y, bx: pts[i].x / aspect, by: pts[i].y, w: width });
  }
  for (const [p, q] of branches) {
    out.push(...bolt(p, q, { rng, depth: Math.max(2, depth - 2), jag, branch: branch * 0.5, width: width * 0.5, aspect }));
  }
  return out;
}

/**
 * Where a straight ray from p along d leaves the picture [0,1]² (display space).
 * @returns {{x, y, t}} t = distance along d (same units as d)
 */
export function rayToEdge(p, d) {
  let t = Infinity;
  if (d.x > 1e-6) t = Math.min(t, (1 - p.x) / d.x);
  if (d.x < -1e-6) t = Math.min(t, -p.x / d.x);
  if (d.y > 1e-6) t = Math.min(t, (1 - p.y) / d.y);
  if (d.y < -1e-6) t = Math.min(t, -p.y / d.y);
  if (!Number.isFinite(t)) t = 0;
  t = Math.max(0, t);
  return { x: p.x + d.x * t, y: p.y + d.y * t, t };
}
