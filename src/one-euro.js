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
    this.x = null;      // filtered value
    this.raw = null;    // previous raw sample (the derivative is taken on the raw signal, as in the paper)
    this.dx = 0;        // filtered derivative (units / s)
    this.t = null;
  }

  /** @param {number} value  @param {number} t  time in seconds */
  filter(value, t) {
    if (this.x === null || this.t === null || t <= this.t) {
      this.x = value;
      this.raw = value;
      this.t = t;
      this.dx = 0;
      return value;
    }
    const dt = t - this.t;
    this.t = t;
    const rawDx = (value - this.raw) / dt;
    this.raw = value;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/**
 * Linear extrapolation x + v·lead, with the lead clamped so a noisy velocity
 * can never throw the point far away. Used to compensate tracking latency.
 */
export function extrapolate(x, v, lead, maxLead = 0.08) {
  return x + v * Math.max(0, Math.min(maxLead, lead));
}

/** Filters an array of {x, y} points with one filter pair per coordinate. */
export class PointsFilter {
  constructor(count, opts) {
    this.filters = Array.from({ length: count * 2 }, () => new OneEuro(opts));
  }

  /**
   * Last filtered points pushed forward in time by `lead` seconds along their
   * filtered velocity (One Euro's smoothed derivative), to hide tracking latency.
   */
  predict(lead) {
    const out = [];
    for (let i = 0; i < this.filters.length; i += 2) {
      const fx = this.filters[i], fy = this.filters[i + 1];
      if (fx.x === null) return null;
      out.push({ x: extrapolate(fx.x, fx.dx, lead), y: extrapolate(fy.x, fy.dx, lead) });
    }
    return out;
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
