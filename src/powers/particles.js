// CPU particles + the glow batch sent to the GPU (pure, unit-tested).
//
// A few thousand particles are cheapest on the CPU: structure-of-arrays
// (Float32Array per field), no allocation per frame, dead particles removed by
// swapping with the last live one. GPU transform feedback only pays off from
// ~100k particles and makes emission from hand positions awkward.
//
// Every glowing thing (particles, beams, bolts, orbs, rings) becomes one
// instance of the same quad in a GlowBatch, so all of them are drawn with ONE
// instanced draw call and one buffer upload per frame.

/** Glow primitive kinds (must match the shader in fx-gl.js). */
export const KIND = { DOT: 0, LINE: 1, ORB: 2, RING: 3, BEAM: 4, SPARK: 5, FLAME: 6 };
export const STRIDE = 12; // ax ay bx by | r g b a | width kind p1 p2

export class GlowBatch {
  constructor(max = 6000) {
    this.max = max;
    this.data = new Float32Array(max * STRIDE);
    this.count = 0;
  }

  reset() { this.count = 0; }

  /**
   * @param ax,ay,bx,by  segment ends in display space (a == b for round things)
   * @param {number[]} c  [r, g, b] 0..1 (can exceed 1 for a hotter core)
   * @param a      opacity
   * @param w      half-width / radius in picture-height units
   * @param kind   KIND.*
   * @param p1,p2  per-kind parameters (ring thickness, seed, charge…)
   * @returns {boolean} false when the batch is full (extra glows are dropped)
   */
  push(ax, ay, bx, by, c, a, w, kind, p1 = 0, p2 = 0) {
    if (this.count >= this.max) return false;
    const d = this.data, o = this.count++ * STRIDE;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = bx; d[o + 3] = by;
    d[o + 4] = c[0]; d[o + 5] = c[1]; d[o + 6] = c[2]; d[o + 7] = a;
    d[o + 8] = w; d[o + 9] = kind; d[o + 10] = p1; d[o + 11] = p2;
    return true;
  }

  /** The filled part, ready for bufferSubData. */
  get view() { return this.data.subarray(0, this.count * STRIDE); }
}

/**
 * Particle pool. Each particle: position, velocity, age / life, size (start →
 * end), colour (start → end), drag, gravity (negative = rises, like fire).
 */
export class Particles {
  constructor(max = 2000) {
    this.max = max;
    this.n = 0;
    const f = () => new Float32Array(max);
    Object.assign(this, {
      x: f(), y: f(), vx: f(), vy: f(), age: f(), life: f(), s0: f(), s1: f(),
      r0: f(), g0: f(), b0: f(), r1: f(), g1: f(), b1: f(), a: f(), drag: f(), grav: f(), kind: new Uint8Array(max),
    });
  }

  clear() { this.n = 0; }

  /**
   * @param {{x, y, vx?, vy?, life?, size?, size1?, color?, color1?, alpha?, drag?, grav?, kind?}} p
   *   speeds in display units / s, sizes in picture-height units, colours [r, g, b]
   */
  emit(p) {
    if (this.n >= this.max) return false;
    const i = this.n++;
    const c0 = p.color ?? [1, 1, 1], c1 = p.color1 ?? c0;
    this.x[i] = p.x; this.y[i] = p.y; this.vx[i] = p.vx ?? 0; this.vy[i] = p.vy ?? 0;
    this.age[i] = 0; this.life[i] = p.life ?? 1;
    this.s0[i] = p.size ?? 0.01; this.s1[i] = p.size1 ?? this.s0[i];
    this.r0[i] = c0[0]; this.g0[i] = c0[1]; this.b0[i] = c0[2];
    this.r1[i] = c1[0]; this.g1[i] = c1[1]; this.b1[i] = c1[2];
    this.a[i] = p.alpha ?? 1; this.drag[i] = p.drag ?? 0; this.grav[i] = p.grav ?? 0;
    this.kind[i] = p.kind ?? KIND.DOT;
    return true;
  }

  /** Moves everything forward by dt seconds; frees dead particles. */
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.#kill(i); continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= k;
      this.vy[i] = this.vy[i] * k + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
  }

  #kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const key of ["x", "y", "vx", "vy", "age", "life", "s0", "s1", "r0", "g0", "b0", "r1", "g1", "b1", "a", "drag", "grav", "kind"]) this[key][i] = this[key][j];
  }

  /** Calls fn(i) for each live particle (used for interactions, e.g. pushing frozen drops). */
  forEach(fn) { for (let i = 0; i < this.n; i++) fn(i); }

  /** Appends every live particle to the glow batch (fades in fast, out slowly). */
  write(batch, alphaScale = 1) {
    const c = [0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      const k = this.age[i] / this.life[i];
      const fade = Math.min(1, k * 12) * (1 - k) * (1 - k * 0.3);
      c[0] = this.r0[i] + (this.r1[i] - this.r0[i]) * k;
      c[1] = this.g0[i] + (this.g1[i] - this.g0[i]) * k;
      c[2] = this.b0[i] + (this.b1[i] - this.b0[i]) * k;
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      if (this.kind[i] === KIND.SPARK) {
        // streak along the velocity (motion blur)
        const tx = this.x[i] - this.vx[i] * 0.03, ty = this.y[i] - this.vy[i] * 0.03;
        if (!batch.push(tx, ty, this.x[i], this.y[i], c, this.a[i] * fade * alphaScale, size, KIND.LINE)) return;
      } else if (this.kind[i] === KIND.FLAME) {
        // a soft tongue stretched upwards (drawn as a DOT capsule: no white core)
        if (!batch.push(this.x[i], this.y[i] + size * 0.3, this.x[i], this.y[i] - size * 1.3, c, this.a[i] * fade * alphaScale, size * 0.6, KIND.DOT)) return;
      } else if (!batch.push(this.x[i], this.y[i], this.x[i], this.y[i], c, this.a[i] * fade * alphaScale, size, this.kind[i])) return;
    }
  }
}

/** Colour helpers for glows ([r, g, b] in 0..1). */
export function mixColor(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
export const WHITE = [1, 1, 1];
export const FIRE = { core: [1, 0.9, 0.55], mid: [1, 0.45, 0.06], edge: [0.85, 0.12, 0.02], smoke: [0.25, 0.08, 0.04] };
