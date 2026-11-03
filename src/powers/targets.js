// Training mode (pure, unit-tested): glowing targets float around the picture;
// every power can hit them. Hits within 2 s of each other build a combo, and
// each hit is worth 10 × combo points.

const COMBO_WINDOW = 2;

export class Targets {
  /** @param {() => number} rng  random source (seeded in tests) */
  constructor(rng = Math.random, { max = 3, radius = 0.055 } = {}) {
    this.rng = rng;
    this.max = max;
    this.radius = radius;
    this.list = [];
    this.score = 0;
    this.combo = 0;
    this.best = 0;
    this.lastHit = -Infinity;
    this.spawnIn = 0.4;
    this.nextId = 1;
  }

  reset() { this.list = []; this.score = 0; this.combo = 0; this.lastHit = -Infinity; this.spawnIn = 0.4; }

  /** Spawns and drifts targets. Spawn spots avoid the middle, where you stand. */
  update(dt, t) {
    if (t - this.lastHit > COMBO_WINDOW) this.combo = 0;
    this.spawnIn -= dt;
    if (this.list.length < this.max && this.spawnIn <= 0) {
      const side = this.rng() < 0.5 ? 0 : 1;
      this.list.push({
        id: this.nextId++,
        x: side ? 0.72 + this.rng() * 0.2 : 0.08 + this.rng() * 0.2,
        y: 0.12 + this.rng() * 0.6,
        vx: (this.rng() - 0.5) * 0.06, vy: (this.rng() - 0.5) * 0.06,
        r: this.radius * (0.8 + this.rng() * 0.5),
        born: t,
      });
      this.spawnIn = 0.8 + this.rng() * 1.2;
    }
    for (const g of this.list) {
      g.x += g.vx * dt; g.y += g.vy * dt;
      if (g.x < 0.05 || g.x > 0.95) g.vx *= -1;
      if (g.y < 0.08 || g.y > 0.85) g.vy *= -1;
    }
  }

  #hit(list, t) {
    if (!list.length) return [];
    this.list = this.list.filter((g) => !list.includes(g));
    for (const _ of list) {
      this.combo = t - this.lastHit <= COMBO_WINDOW ? this.combo + 1 : 1;
      this.lastHit = t;
      this.score += 10 * this.combo;
    }
    this.best = Math.max(this.best, this.score);
    return list;
  }

  /** Targets touching a circle (fireball, black hole, energy ball). */
  hitCircle(x, y, r, t, aspect = 1) {
    return this.#hit(this.list.filter((g) => Math.hypot((g.x - x) * aspect, g.y - y) < g.r + r), t);
  }

  /** Targets touching a thick segment (beam, bolt, laser). w = half-width. */
  hitSegment(ax, ay, bx, by, w, t, aspect = 1) {
    return this.#hit(this.list.filter((g) => segDist(g.x, g.y, ax, ay, bx, by, aspect) < g.r + w), t);
  }

  /** Targets crossed by an expanding ring (shockwave) of radius r and half-thickness w. */
  hitRing(x, y, r, w, t, aspect = 1) {
    return this.#hit(this.list.filter((g) => Math.abs(Math.hypot((g.x - x) * aspect, g.y - y) - r) < g.r + w), t);
  }
}

/** Distance (height units) from point p to segment ab, all in display space. */
export function segDist(px, py, ax, ay, bx, by, aspect = 1) {
  const dx = (bx - ax) * aspect, dy = by - ay, ex = (px - ax) * aspect, ey = py - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? Math.max(0, Math.min(1, (ex * dx + ey * dy) / l2)) : 0;
  return Math.hypot(ex - dx * k, ey - dy * k);
}
