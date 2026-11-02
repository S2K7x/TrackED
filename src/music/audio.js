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

const MAX_VOICES = 24;
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
    Object.assign(this.limiter, {});
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
    this.bus.connect(this.master);
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
   * Starts a note; returns a handle with stop(). One-shot timbres stop themselves.
   * @param {number} midi
   * @param {{timbre?: "glass"|"synth"|"pad"|"pluck", velocity?: number, hold?: boolean}} o
   */
  noteOn(midi, { timbre = "glass", velocity = 0.8, hold = false } = {}) {
    if (!this.ready) return { stop() {} };
    this.#midi(0x90, midi, velocity);
    const stopMidi = () => this.#midi(0x80, midi, 0);
    const f = midiToFreq(midi);
    if (timbre === "pluck" && this.pluckNode) {
      this.pluckNode.port.postMessage({ type: "pluck", freq: f, velocity, seconds: 3 });
      setTimeout(stopMidi, 400);
      return { stop() {} };
    }
    const c = this.ctx, t = c.currentTime;
    const env = c.createGain();
    env.gain.value = 0;
    env.connect(this.bus);
    const oscs = [];
    const osc = (type, freq, gain = 1, detune = 0) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = c.createGain();
      g.gain.value = gain;
      o.connect(g);
      oscs.push(o);
      return g;
    };
    let release = 0.3, sustain = 0.6;
    if (timbre === "glass") {          // bell-like: fundamental + soft octave, long natural decay
      osc("sine", f, 0.8).connect(env);
      osc("sine", f * 2, 0.25).connect(env);
      osc("triangle", f * 3.01, 0.06).connect(env);
      env.gain.setTargetAtTime(0.5 * velocity, t, 0.004);
      env.gain.setTargetAtTime(0.0001, t + 0.02, hold ? 1.5 : 0.45);
      release = 0.35;
    } else if (timbre === "synth" || timbre === "pluck") {   // saw through a sweeping low-pass
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 4;
      lp.frequency.setValueAtTime(400 + 5000 * velocity, t);
      lp.frequency.setTargetAtTime(timbre === "pluck" ? 500 : 1200, t, timbre === "pluck" ? 0.08 : 0.25);
      lp.connect(env);
      osc("sawtooth", f, 0.5).connect(lp);
      osc("square", f / 2, 0.15).connect(lp);
      env.gain.setTargetAtTime(0.45 * velocity, t, 0.005);
      sustain = timbre === "pluck" ? 0.0001 : 0.6;
      env.gain.setTargetAtTime(0.45 * velocity * sustain, t + 0.05, timbre === "pluck" ? 0.12 : 0.3);
    } else {                           // pad: detuned saws, slow attack
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1400;
      lp.connect(env);
      osc("sawtooth", f, 0.3, -9).connect(lp);
      osc("sawtooth", f, 0.3, 9).connect(lp);
      osc("triangle", f / 2, 0.3).connect(lp);
      env.gain.setTargetAtTime(0.4 * velocity, t, 0.12);
      release = 0.9;
    }
    for (const o of oscs) o.start(t);
    let stopped = false;
    const voice = {
      stop: (r = release) => {
        if (stopped) return;
        stopped = true;
        stopMidi();
        const now = c.currentTime;
        env.gain.cancelScheduledValues(now);
        env.gain.setValueAtTime(env.gain.value, now);
        env.gain.setTargetAtTime(0, now, r / 4);
        for (const o of oscs) o.stop(now + r * 1.5);
        oscs[0].onended = () => env.disconnect();
        this.voices = this.voices.filter((v) => v !== voice);
      },
    };
    this.#track(voice);
    if (!hold) setTimeout(() => voice.stop(), timbre === "pad" ? 900 : 1600);
    return voice;
  }

  /** Synthesised drum hits (no samples). */
  drum(name, velocity = 0.9) {
    if (!this.ready) return;
    this.#midi(0x99, GM_DRUMS[name] ?? 38, velocity, true);
    setTimeout(() => this.#midi(0x89, GM_DRUMS[name] ?? 38, 0, true), 100);
    const c = this.ctx, t = c.currentTime;
    const out = c.createGain();
    out.gain.value = velocity;
    out.connect(this.bus);
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
      case "kick": tone(160, 42, 0.5, "sine", 1.1); noise(0.02, "lowpass", 3000, 1, 0.3, 0.005); break;
      case "snare": tone(190, 140, 0.15, "triangle", 0.5); noise(0.25, "highpass", 1200, 0.7, 0.8, 0.05); break;
      case "hat": noise(0.08, "highpass", 7500, 0.8, 0.5, 0.015); break;
      case "clap": for (const d of [0, 0.012, 0.024]) setTimeout(() => noise(0.15, "bandpass", 1500, 2, 0.9, 0.03), d * 1000); break;
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
