// Superpower sound effects, all synthesised (no samples): shaped noise through
// sweeping filters (whooshes, blasts, thunder) and oscillators with pitch
// envelopes (booms, zaps). They go through the music engine's bus, so they get
// its reverb and limiter and end up in recorded videos.

export class PowerSfx {
  /** @param {import("../music/audio.js").AudioEngine} engine */
  constructor(engine) {
    this.engine = engine;
    this.enabled = true;
    this.loops = new Set();
  }

  get on() { return this.enabled && this.engine.ready; }

  #out(gain) {
    const c = this.engine.ctx, g = c.createGain();
    g.gain.value = gain;
    g.connect(this.engine.bus);
    setTimeout(() => g.disconnect(), 5000);
    return g;
  }

  /** Filtered noise burst. from/to = filter sweep (Hz). */
  noise({ dur = 0.5, type = "bandpass", from = 800, to = 800, q = 1, gain = 0.5, attack = 0.005, delay = 0 }) {
    if (!this.on) return;
    const c = this.engine.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.engine.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.#out(gain));
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  /** Oscillator with an exponential pitch glide. */
  tone({ type = "sine", from = 440, to = 440, dur = 0.3, gain = 0.4, attack = 0.005, delay = 0 }) {
    if (!this.on) return;
    const c = this.engine.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, to), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.#out(gain));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /**
   * Continuous sound (charging hum, aura, laser): set(level 0..1, pitch 0..1) every frame.
   * @param {"hum"|"laser"|"aura"} kind
   */
  loop(kind) {
    if (!this.on) return null;
    const c = this.engine.ctx, out = this.#loopOut();
    const base = { hum: 70, laser: 220, aura: 55 }[kind] ?? 70;
    const a = c.createOscillator(), b = c.createOscillator();
    a.type = "sawtooth"; b.type = kind === "laser" ? "square" : "sine";
    a.frequency.value = base; b.frequency.value = base * (kind === "laser" ? 1.5 : 0.5);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 400; lp.Q.value = 6;
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.frequency.value = kind === "laser" ? 18 : 7;
    depth.gain.value = kind === "laser" ? 40 : 15;
    lfo.connect(depth).connect(a.detune);
    // crackle: band-passed noise on top
    const n = c.createBufferSource();
    n.buffer = this.engine.noise; n.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 2500; bp.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.value = 0.25;
    a.connect(lp); b.connect(lp); lp.connect(out);
    n.connect(bp).connect(ng).connect(out);
    for (const s of [a, b, lfo, n]) s.start();
    const handle = {
      set: (level, pitch = 0) => {
        const t = c.currentTime, f = base * (1 + pitch * 2.5);
        a.frequency.setTargetAtTime(f, t, 0.05);
        b.frequency.setTargetAtTime(f * (kind === "laser" ? 1.5 : 0.5), t, 0.05);
        lp.frequency.setTargetAtTime(300 + 3200 * pitch * level, t, 0.05);
        bp.frequency.setTargetAtTime(1500 + 4000 * pitch, t, 0.05);
        out.gain.setTargetAtTime(0.22 * level, t, 0.04);
      },
      stop: () => {
        if (!this.loops.delete(handle)) return;
        const t = c.currentTime;
        out.gain.setTargetAtTime(0, t, 0.06);
        for (const s of [a, b, lfo, n]) s.stop(t + 0.4);
        setTimeout(() => out.disconnect(), 600);
      },
    };
    this.loops.add(handle);
    return handle;
  }

  #loopOut() {
    const g = this.engine.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.engine.bus);
    return g;
  }

  stopAll() { for (const l of [...this.loops]) l.stop(); }

  // ---------------- recipes ----------------
  blast(power = 1) {
    this.noise({ dur: 1.2 + power, type: "lowpass", from: 6000, to: 200, q: 0.7, gain: 0.7 * power + 0.2, attack: 0.02 });
    this.tone({ type: "sawtooth", from: 180, to: 40, dur: 1 + power, gain: 0.3 });
    this.tone({ type: "sine", from: 90, to: 30, dur: 1.2, gain: 0.6 });
  }
  fizzle() { this.noise({ dur: 0.35, type: "highpass", from: 3000, to: 8000, gain: 0.2 }); }
  thunder() {
    this.noise({ dur: 0.12, type: "highpass", from: 2500, to: 1200, gain: 0.7, attack: 0.001 });
    this.noise({ dur: 1.6, type: "lowpass", from: 900, to: 60, q: 0.5, gain: 0.6, attack: 0.03, delay: 0.04 });
  }
  zap() { this.noise({ dur: 0.08, type: "bandpass", from: 3000 + Math.random() * 2000, to: 6000, q: 2, gain: 0.08 }); }
  whoosh() { this.noise({ dur: 0.45, type: "bandpass", from: 300, to: 2400, q: 1.5, gain: 0.45, attack: 0.05 }); }
  boom(size = 1) {
    this.noise({ dur: 0.9 * size, type: "lowpass", from: 2500, to: 80, q: 0.6, gain: 0.6 * size, attack: 0.003 });
    this.tone({ type: "sine", from: 140, to: 35, dur: 0.6 * size, gain: 0.7 });
  }
  shock() {
    this.tone({ type: "sine", from: 160, to: 28, dur: 0.7, gain: 0.7 });
    this.noise({ dur: 0.5, type: "bandpass", from: 1800, to: 200, q: 0.8, gain: 0.35, attack: 0.002 });
  }
  timeStop(on) {
    this.tone({ type: "triangle", from: on ? 900 : 110, to: on ? 110 : 900, dur: 0.9, gain: 0.35 });
    this.noise({ dur: 0.9, type: "bandpass", from: on ? 4000 : 300, to: on ? 300 : 4000, q: 2, gain: 0.3 });
    this.tone({ type: "sine", from: 2000, to: 1990, dur: 1.4, gain: 0.08, delay: 0.1 });
  }
  cloak(on) {
    this.noise({ dur: 0.9, type: "bandpass", from: on ? 400 : 5000, to: on ? 6000 : 400, q: 3, gain: 0.35, attack: 0.1 });
    for (let i = 0; i < 4; i++) this.tone({ type: "sine", from: (on ? 1200 : 2400) * (1 + i * 0.25), to: (on ? 2400 : 1200) * (1 + i * 0.25), dur: 0.5, gain: 0.05, delay: i * 0.08 });
  }
  puff() { this.noise({ dur: 0.4, type: "lowpass", from: 2000, to: 300, gain: 0.4, attack: 0.01 }); }
  portal() {
    this.tone({ type: "sine", from: 200, to: 800, dur: 1.2, gain: 0.25, attack: 0.2 });
    this.tone({ type: "triangle", from: 300, to: 1200, dur: 1.2, gain: 0.1, attack: 0.2 });
    this.noise({ dur: 1.4, type: "bandpass", from: 300, to: 3000, q: 4, gain: 0.25, attack: 0.3 });
  }
  close() { this.tone({ type: "sine", from: 800, to: 120, dur: 0.5, gain: 0.25 }); }
  shieldUp() {
    this.tone({ type: "sine", from: 180, to: 520, dur: 0.35, gain: 0.25, attack: 0.03 });
    this.noise({ dur: 0.35, type: "bandpass", from: 600, to: 3000, q: 3, gain: 0.15, attack: 0.05 });
  }
  ping() { this.tone({ type: "sine", from: 1400 + Math.random() * 300, to: 700, dur: 0.4, gain: 0.18 }); }
  crackle() { this.noise({ dur: 0.05 + Math.random() * 0.05, type: "highpass", from: 4000 + Math.random() * 3000, to: 9000, q: 1, gain: 0.07 }); }
  shatter() {
    this.noise({ dur: 0.5, type: "highpass", from: 3000, to: 6000, q: 0.7, gain: 0.45, attack: 0.002 });
    for (let i = 0; i < 5; i++) this.tone({ type: "sine", from: 2000 + Math.random() * 2500, to: 1500, dur: 0.25, gain: 0.05, delay: Math.random() * 0.15 });
  }
  grab() { this.tone({ type: "triangle", from: 300, to: 180, dur: 0.15, gain: 0.2 }); }
  boing() {
    this.tone({ type: "sine", from: 140, to: 420, dur: 0.18, gain: 0.3 });
    this.tone({ type: "sine", from: 420, to: 160, dur: 0.35, gain: 0.2, delay: 0.15 });
  }
  teleport() {
    this.tone({ type: "sawtooth", from: 200, to: 2400, dur: 0.25, gain: 0.12 });
    this.noise({ dur: 0.4, type: "bandpass", from: 6000, to: 500, q: 2, gain: 0.3, attack: 0.01, delay: 0.1 });
    this.tone({ type: "sine", from: 1600, to: 1550, dur: 0.6, gain: 0.08, delay: 0.25 });
  }
  fanfare() { [0, 4, 7, 12].forEach((s, i) => this.tone({ type: "square", from: 523 * 2 ** (s / 12), to: 523 * 2 ** (s / 12), dur: 0.22, gain: 0.08, delay: i * 0.12 })); }
  hit(combo = 1) {
    const f = 660 * 2 ** (Math.min(combo - 1, 8) / 12);
    this.tone({ type: "square", from: f, to: f * 2, dur: 0.12, gain: 0.12 });
    this.tone({ type: "square", from: f * 1.5, to: f * 3, dur: 0.12, gain: 0.08, delay: 0.06 });
  }
}
