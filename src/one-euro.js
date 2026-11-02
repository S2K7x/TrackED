// One Euro Filter (Casiez, Roussel & Vogel, CHI 2012).
// Adaptive low-pass filter: strong smoothing when the signal moves slowly
// (kills jitter), light smoothing when it moves fast (kills lag).
//   minCutoff: lower = less jitter at rest, more lag
//   beta:      higher = less lag during fast movements

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor({ minCutoff = 1.2, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  /** @param {number} value  @param {number} t  time in seconds */
  filter(value, t) {
    if (this.x === null || this.t === null || t <= this.t) {
      this.x = value;
      this.t = t;
      this.dx = 0;
      return value;
    }
    const dt = t - this.t;
    this.t = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** Filters an array of {x, y} points with one filter pair per coordinate. */
export class PointsFilter {
  constructor(count, opts) {
    this.filters = Array.from({ length: count * 2 }, () => new OneEuro(opts));
  }

  reset() {
    for (const f of this.filters) f.reset();
  }

  filter(points, t) {
    return points.map((p, i) => ({
      x: this.filters[i * 2].filter(p.x, t),
      y: this.filters[i * 2 + 1].filter(p.y, t),
    }));
  }
}
