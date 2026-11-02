// Audio engine: every sound is synthesised in the browser (no samples).
//
// Signal flow:
//   voices → bus ─┬─────────────────────────────→ master → limiter → speakers
//                 ├→ reverb send → convolver ─────↗          └→ stream (video recording)
//                 └→ echo send → delay ⟲ (low-passed feedback) ↗
//
// Low latency: AudioContext latencyHint "interactive", notes start at
// currentTime (no look-ahead). Parameter changes use setTargetAtTime so they
// never click. Voices are capped (oldest stolen first) to bound CPU.

import { midiToFreq } from "./theory.js";

const MAX_VOICES = 32;

/**
 * Synth recipes. build() wires oscillators into `env`; the shared code applies
 * the amplitude envelope (attack/decay time constants, sustain level, release)
 * and stops the note after `length` seconds unless it is held.
 */
const TIMBRES = {
  glass: { attack: 0.004, decay: 0.45, sustain: 0.05, release: 0.35, level: 0.5, length: 1.4,
    build({ f, env, osc, gain }) { osc("sine", f).connect(gain(0.8, env)); osc("sine", f * 2).connect(gain(0.25, env)); osc("triangle", f * 3.01).connect(gain(0.06, env)); } },
  // FM electric piano: a sine carrier whose frequency is modulated by a sine at the same
  // ratio; the modulation index decays, so the attack is bright and the tail is mellow
  epiano: { attack: 0.003, decay: 0.8, sustain: 0.15, release: 0.4, level: 0.55, length: 1.8,
    build({ c, t, f, env, osc, gain }) {
      const car = osc("sine", f), mod = osc("sine", f), idx = c.createGain();
      idx.gain.setValueAtTime(f * 2.2, t); idx.gain.setTargetAtTime(f * 0.3, t, 0.25);
      mod.connect(idx).connect(car.frequency);
      car.connect(gain(0.9, env));
      osc("sine", f * 2).connect(gain(0.08, env));
    } },
  // additive organ: drawbars at 1, 2, 3 and 4 × the fundamental, instant attack, full sustain
  organ: { attack: 0.006, decay: 1, sustain: 1, release: 0.08, level: 0.32, length: 0.5,
    build({ f, env, osc, gain }) { [[1, 0.6], [2, 0.4], [3, 0.25], [4, 0.15]].forEach(([k, a]) => osc("sine", f * k).connect(gain(a, env))); } },
  // marimba: FM with a 4:1 ratio and a very fast index decay = wooden "tock"
  marimba: { attack: 0.002, decay: 0.25, sustain: 0.01, release: 0.2, level: 0.6, length: 0.8,
    build({ c, t, f, env, osc, gain }) {
      const car = osc("sine", f), mod = osc("sine", f * 4), idx = c.createGain();
      idx.gain.setValueAtTime(f * 3, t); idx.gain.setTargetAtTime(0, t, 0.03);
      mod.connect(idx).connect(car.frequency);
      car.connect(gain(1, env));
    } },
  // strings: detuned saws, slow attack, low-pass, gentle vibrato
  strings: { attack: 0.18, decay: 1, sustain: 0.85, release: 0.7, level: 0.32, length: 1.2,
    build({ c, f, env, osc, gain }) {
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2200; lp.connect(env);
      const lfo = osc("sine", 5.2), depth = c.createGain(); depth.gain.value = 9; lfo.connect(depth);
      for (const d of [-8, 0, 8]) { const o = osc("sawtooth", f, d); depth.connect(o.detune); o.connect(gain(0.3, lp)); }
    } },
  // brass: saw through a filter whose cutoff swells with the attack
  brass: { attack: 0.04, decay: 0.6, sustain: 0.7, release: 0.2, level: 0.38, length: 0.9,
    build({ c, t, f, velocity, env, osc, gain }) {
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 2;
      lp.frequency.setValueAtTime(f * 1.5, t); lp.frequency.setTargetAtTime(f * (3 + 5 * velocity), t, 0.06); lp.frequency.setTargetAtTime(f * 3, t + 0.15, 0.3);
      lp.connect(env);
      osc("sawtooth", f).connect(gain(0.5, lp)); osc("sawtooth", f, 6).connect(gain(0.3, lp));
    } },
  synth: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.3, level: 0.45, length: 1.2,
    build({ c, t, f, velocity, env, osc, gain }) {
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 4;
      lp.frequency.setValueAtTime(400 + 5000 * velocity, t); lp.frequency.setTargetAtTime(1200, t, 0.25); lp.connect(env);
      osc("sawtooth", f).connect(gain(0.5, lp)); osc("square", f / 2).connect(gain(0.15, lp));
    } },
  pad: { attack: 0.12, decay: 1, sustain: 0.9, release: 0.9, level: 0.4, length: 0.9,
    build({ c, f, env, osc, gain }) {
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400; lp.connect(env);
      osc("sawtooth", f, -9).connect(gain(0.3, lp)); osc("sawtooth", f, 9).connect(gain(0.3, lp)); osc("triangle", f / 2).connect(gain(0.3, lp));
    } },
  // 8-bit: pulse-ish square, no filter, a quick pitch blip on the attack
  chip: { attack: 0.002, decay: 0.15, sustain: 0.5, release: 0.05, level: 0.22, length: 0.4,
    build({ t, f, env, osc, gain }) { const o = osc("square", f * 2); o.frequency.setValueAtTime(f * 2, t); o.frequency.setTargetAtTime(f, t, 0.01); o.connect(gain(0.6, env)); osc("square", f, 12).connect(gain(0.3, env)); } },
  // choir: a buzzy source through three band-pass "formants" of the vowel "ah"
  choir: { attack: 0.15, decay: 1, sustain: 0.85, release: 0.6, level: 0.9, length: 1.2,
    build({ c, f, env, osc, gain }) {
      const src = c.createGain(); src.gain.value = 1;
      for (const d of [-6, 6]) osc("sawtooth", f, d).connect(gain(0.3, src));
      for (const [ff, q, a] of [[800, 8, 1], [1150, 9, 0.6], [2900, 12, 0.25]]) {
        const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = ff; bp.Q.value = q;
        src.connect(bp); bp.connect(gain(a, env));
      }
    } },
  // bass: sine sub + a filtered saw for definition
  bass: { attack: 0.004, decay: 0.2, sustain: 0.7, release: 0.08, level: 0.6, length: 0.3,
    build({ c, f, env, osc, gain }) {
      osc("sine", f).connect(gain(0.8, env));
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = Math.min(1200, f * 6); lp.connect(env);
      osc("sawtooth", f).connect(gain(0.25, lp));
    } },
};
// a "pluck" without the AudioWorklet falls back to a fast-decaying synth
TIMBRES.pluck = { ...TIMBRES.synth, sustain: 0.0001, decay: 0.12, length: 0.9 };

/** Drum kits: kick pitch sweep [from, to, seconds], click level, optional low-pass tone. */
const KITS = {
  acoustic: { kick: [150, 48, 0.45], click: 0.35 },
  electro: { kick: [120, 38, 0.9], click: 0.15 },     // long 808-style boom
  lofi: { kick: [110, 45, 0.4], click: 0.1, tone: 3200 },
};
const GM_DRUMS = { kick: 36, snare: 38, clap: 39, hat: 42, tom: 45, crash: 49 };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.midiOut = null;
  }

  /** Creates / resumes the context. Must be called from a user gesture the first time (autoplay policies). */
  async ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error("Web Audio is not supported in this browser");
      this.ctx = new AC({ latencyHint: "interactive" });
      this.#build();
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
    return this.ctx;
  }

  get ready() { return this.ctx?.state === "running"; }

  /** Output latency in ms (what the hands-to-ear delay adds on top of tracking). */
  get latencyMs() {
    if (!this.ctx) return 0;
    return Math.round(((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000);
  }

  #build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.master.connect(this.limiter);
    this.limiter.connect(c.destination);
    // a copy of the mix for video recording
    this.streamDest = c.createMediaStreamDestination?.() ?? null;
    if (this.streamDest) this.limiter.connect(this.streamDest);

    this.bus = c.createGain();
    // DJ filter (wide open unless the DJ instrument moves it)
    this.djFilter = c.createBiquadFilter();
    this.djFilter.type = "lowpass";
    this.djFilter.frequency.value = 20000;
    this.djFilter.Q.value = 0.7;
    this.bus.connect(this.djFilter).connect(this.master);
    // reverb
    this.reverb = c.createConvolver();
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.25;
    this.bus.connect(this.reverbSend).connect(this.reverb).connect(this.master);
    this.setReverb("room");
    // echo
    this.delay = c.createDelay(1);
    this.delay.delayTime.value = 0.32;
    const fb = c.createGain();
    fb.gain.value = 0.35;
    const tone = c.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2500;
    this.echoSend = c.createGain();
    this.echoSend.gain.value = 0;
    this.bus.connect(this.echoSend).connect(this.delay);
    this.delay.connect(tone).connect(fb).connect(this.delay);
    this.delay.connect(this.master);

    // shared white noise (drums)
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // plucked strings in an AudioWorklet (falls back to a synth pluck if unavailable)
    this.pluckNode = null;
    c.audioWorklet?.addModule(new URL("./pluck-worklet.js", import.meta.url))
      .then(() => {
        this.pluckNode = new AudioWorkletNode(c, "tracked-pluck", { outputChannelCount: [1] });
        this.pluckNode.connect(this.bus);
      })
      .catch((err) => console.warn("pluck worklet unavailable, using a synth pluck:", err));
  }

  /** "off" | "room" | "hall": generated impulse response (decaying stereo noise). */
  setReverb(kind) {
    if (!this.ctx) return;
    const c = this.ctx;
    const seconds = { off: 0.1, room: 1.2, hall: 2.8 }[kind] ?? 1.2;
    this.reverbSend.gain.setTargetAtTime(kind === "off" ? 0 : kind === "hall" ? 0.4 : 0.25, c.currentTime, 0.05);
    const len = Math.round(c.sampleRate * seconds);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    this.reverb.buffer = ir;
  }

  setEcho(on) {
    if (this.ctx) this.echoSend.gain.setTargetAtTime(on ? 0.35 : 0, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  #track(voice) {
    this.voices.push(voice);
    if (this.voices.length > MAX_VOICES) this.voices.shift().stop(0.01); // steal the oldest
    return voice;
  }

  /**
   * Starts a note; returns a handle with stop().
   * @param {number} midi
   * @param {{timbre?: string, velocity?: number, hold?: boolean, when?: number, duration?: number}} o
   *   when = audio-clock start time (scheduled notes from the band / arp / sequencer);
   *   duration = auto-release after that many seconds (default depends on the timbre);
   *   hold = sustain until stop() (pinch keys).
   */
  noteOn(midi, { timbre = "glass", velocity = 0.8, hold = false, when = 0, duration } = {}) {
    if (!this.ready) return { stop() {} };
    const c = this.ctx, t = Math.max(c.currentTime, when || 0);
    const delayMs = Math.max(0, (t - c.currentTime) * 1000);
    setTimeout(() => this.#midi(0x90, midi, velocity), delayMs);
    const stopMidi = () => this.#midi(0x80, midi, 0);
    const f = midiToFreq(midi);
    if (timbre === "pluck" && this.pluckNode) {
      setTimeout(() => this.pluckNode?.port.postMessage({ type: "pluck", freq: f, velocity, seconds: 3 }), delayMs);
      setTimeout(stopMidi, delayMs + 400);
      return { stop() {} };
    }
    const T = TIMBRES[timbre] ?? TIMBRES.glass;
    const env = c.createGain();
    env.gain.value = 0;
    env.connect(this.bus);
    const oscs = [];
    const osc = (type, freq, detune = 0) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      oscs.push(o);
      return o;
    };
    const gain = (v, to) => { const g = c.createGain(); g.gain.value = v; g.connect(to); return g; };
    T.build({ c, t, f, velocity, env, osc, gain });
    // amplitude envelope: attack → decay to sustain
    const peak = T.level * velocity;
    env.gain.setValueAtTime(0, t);
    env.gain.setTargetAtTime(peak, t, T.attack);
    env.gain.setTargetAtTime(peak * T.sustain, t + T.attack * 3, T.decay);
    for (const o of oscs) o.start(t);
    let stopped = false;
    const voice = {
      stop: (r = T.release, at = c.currentTime) => {
        if (stopped) return;
        stopped = true;
        setTimeout(stopMidi, Math.max(0, (at - c.currentTime) * 1000));
        env.gain.cancelScheduledValues(at);
        env.gain.setTargetAtTime(0, at, r / 4);
        for (const o of oscs) o.stop(at + r * 1.5);
        oscs[0].onended = () => env.disconnect();
        this.voices = this.voices.filter((v) => v !== voice);
      },
    };
    this.#track(voice);
    if (!hold) voice.stop(T.release, t + (duration ?? T.length));
    return voice;
  }

  /** Metronome click on the audio clock. */
  click(when, accent = false) {
    if (!this.ready) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(accent ? 0.5 : 0.3, when);
    g.gain.setTargetAtTime(0.0001, when + 0.002, 0.012);
    o.connect(g).connect(this.master);
    o.start(when);
    o.stop(when + 0.08);
  }

  /** DJ filter on the whole instrument + band bus: cutoff 0..1 (closed → open), resonance 0..1. */
  setFilter(cutoff = 1, resonance = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.djFilter.frequency.setTargetAtTime(120 * 2 ** (cutoff * 7.4), t, 0.03);   // 120 Hz → ~20 kHz, exponential
    this.djFilter.Q.setTargetAtTime(0.7 + resonance * 12, t, 0.05);
  }

  setEchoAmount(v) {
    if (this.ctx) this.echoSend.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Synthesised drum hits (no samples). */
  drum(name, velocity = 0.9, { kit = "acoustic", when = 0 } = {}) {
    if (!this.ready) return;
    const c = this.ctx, t = Math.max(c.currentTime, when || 0);
    const delayMs = Math.max(0, (t - c.currentTime) * 1000);
    setTimeout(() => this.#midi(0x99, GM_DRUMS[name] ?? 38, velocity, true), delayMs);
    setTimeout(() => this.#midi(0x89, GM_DRUMS[name] ?? 38, 0, true), delayMs + 100);
    const K = KITS[kit] ?? KITS.acoustic;
    const out = c.createGain();
    out.gain.value = velocity;
    if (K.tone) {           // lo-fi: dull, slightly crushed-sounding top end
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = K.tone;
      out.connect(lp).connect(this.bus);
    } else out.connect(this.bus);
    const noise = (dur, type, freq, q = 1, gain = 1, decay = dur / 4) => {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.setTargetAtTime(0.0001, t + 0.002, decay);
      s.connect(f).connect(g).connect(out);
      s.start(t, Math.random() * 0.5);
      s.stop(t + dur);
    };
    const tone = (from, to, dur, type = "sine", gain = 1) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.4);
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.setTargetAtTime(0.0001, t + 0.005, dur / 4);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur);
    };
    switch (name) {
      case "kick": tone(K.kick[0], K.kick[1], K.kick[2], "sine", 1.1); noise(0.02, "lowpass", 3000, 1, K.click, 0.005); break;
      case "snare": tone(190, 140, 0.15, "triangle", 0.5); noise(0.25, "highpass", 1200, 0.7, 0.8, 0.05); break;
      case "hat": noise(0.08, "highpass", 7500, 0.8, 0.5, 0.015); break;
      case "clap": noise(0.15, "bandpass", 1500, 2, 0.9, 0.03); setTimeout(() => noise(0.12, "bandpass", 1400, 2, 0.6, 0.03), delayMs + 12); break;
      case "tom": tone(220, 110, 0.4, "sine", 0.9); break;
      case "crash": noise(1.4, "highpass", 5000, 0.6, 0.45, 0.35); break;
      default: break;
    }
    setTimeout(() => out.disconnect(), 2000);
  }

  /** Continuous theremin voice: call update() every frame, stop() when hands leave. */
  theremin() {
    if (!this.ready) return null;
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    out.connect(this.bus);
    const a = c.createOscillator(), b = c.createOscillator();
    a.type = "sine";
    b.type = "triangle";
    const bg = c.createGain();
    bg.gain.value = 0.35;
    a.connect(out);
    b.connect(bg).connect(out);
    // gentle vibrato (5.5 Hz, ±12 cents), the theremin's signature
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.value = 12;
    lfo.connect(depth);
    depth.connect(a.detune);
    depth.connect(b.detune);
    for (const o of [a, b, lfo]) o.start();
    return {
      update(midi, volume) {
        const t = c.currentTime, f = midiToFreq(midi);
        a.frequency.setTargetAtTime(f, t, 0.03);      // portamento glide
        b.frequency.setTargetAtTime(f, t, 0.03);
        out.gain.setTargetAtTime(volume * 0.5, t, 0.04);
      },
      stop() {
        const t = c.currentTime;
        out.gain.setTargetAtTime(0, t, 0.05);
        for (const o of [a, b, lfo]) o.stop(t + 0.4);
        setTimeout(() => out.disconnect(), 600);
      },
    };
  }

  /** Audio track for video recording (null if unsupported). */
  get stream() { return this.streamDest?.stream ?? null; }

  // ---------------- Web MIDI output (Chrome, Edge…) ----------------
  /** @returns {Promise<string|null>} name of the first MIDI output, or null */
  async enableMidi() {
    if (!navigator.requestMIDIAccess) throw new Error("Web MIDI isn't supported in this browser");
    const access = await navigator.requestMIDIAccess();
    this.midiOut = [...access.outputs.values()][0] ?? null;
    return this.midiOut?.name ?? null;
  }

  disableMidi() { this.midiOut = null; }

  #midi(status, note, velocity, drums = false) {
    if (!this.midiOut) return;
    try {
      this.midiOut.send([drums ? status : status & 0xf0, Math.round(note) & 127, Math.round(velocity * 127) & 127]);
    } catch { /* port closed */ }
  }

  stopAll() { for (const v of [...this.voices]) v.stop(0.05); }

  async suspend() { if (this.ctx?.state === "running") await this.ctx.suspend(); }
}
