// Training mode (pure, unit-tested): 60-second rounds of glowing targets that
// every power can hit. Hits within 2 s of each other build a combo; a hit is
// worth 10 × combo points (× 3 for a rare golden target). The longer the round
// runs, the more targets there are and the faster they drift. A new round
// starts by itself a few seconds after the end.

const COMBO_WINDOW = 2;
export const ROUND_SECONDS = 60;
export const BREAK_SECONDS = 6;

export class Targets {
  /** @param {() => number} rng  random source (seeded in tests) */
  constructor(rng = Math.random, { max = 3, radius = 0.055, round = ROUND_SECONDS } = {}) {
    this.rng = rng;
    this.baseMax = max;
    this.radius = radius;
    this.roundLength = round;
    this.best = 0;
    this.nextId = 1;
    this.reset();
  }

  reset() {
    this.list = [];
    this.score = 0;
    this.combo = 0;
    this.lastHit = -Infinity;
    this.spawnIn = 0.4;
    this.start = null;       // round start time; null = starts on the next update
    this.endedAt = null;
  }

  /** Starts a fresh round on the next update. */
  startRound() { this.reset(); }

  get over() { return this.endedAt !== null; }
  timeLeft(t) { return this.start === null ? this.roundLength : Math.max(0, this.roundLength - (t - this.start)); }
  restartIn(t) { return this.endedAt === null ? 0 : Math.max(0, BREAK_SECONDS - (t - this.endedAt)); }

  /** Difficulty 0 → 1 over the round. */
  level(t) { return this.start === null ? 0 : Math.min(1, (t - this.start) / this.roundLength); }

  update(dt, t) {
    if (this.start === null) this.start = t;
    if (this.over) {
      if (this.restartIn(t) <= 0) { const best = this.best; this.reset(); this.best = best; this.start = t; }
      return;
    }
    if (this.timeLeft(t) <= 0) { this.endedAt = t; this.list = []; return; }
    if (t - this.lastHit > COMBO_WINDOW) this.combo = 0;
    const lv = this.level(t), max = this.baseMax + Math.floor(lv * 3), speed = 0.06 * (1 + 1.5 * lv);
    this.spawnIn -= dt;
    if (this.list.length < max && this.spawnIn <= 0) {
      const side = this.rng() < 0.5 ? 0 : 1;
      const gold = this.rng() < 0.12;
      this.list.push({
        id: this.nextId++,
        x: side ? 0.72 + this.rng() * 0.2 : 0.08 + this.rng() * 0.2,
        y: 0.12 + this.rng() * 0.6,
        vx: (this.rng() - 0.5) * speed * (gold ? 2 : 1), vy: (this.rng() - 0.5) * speed * (gold ? 2 : 1),
        r: this.radius * (gold ? 0.75 : 0.8 + this.rng() * 0.5),
        gold, born: t,
      });
      this.spawnIn = (0.8 + this.rng() * 1.2) * (1 - 0.4 * lv);
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
    for (const g of list) {
      this.combo = t - this.lastHit <= COMBO_WINDOW ? this.combo + 1 : 1;
      this.lastHit = t;
      g.points = 10 * this.combo * (g.gold ? 3 : 1);
      this.score += g.points;
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
