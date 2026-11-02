// AudioWorklet: Karplus-Strong plucked strings (Karplus & Strong, 1983; see
// J. O. Smith, CCRMA "Physical Audio Signal Processing").
//
// Why a worklet: a DelayNode inside a feedback loop can't be shorter than one
// 128-sample render quantum in Web Audio, which caps the pitch around 345 Hz.
// Here each voice is its own short ring buffer, so any pitch works.
//
// Per voice: a buffer of N = sampleRate / f samples filled with filtered noise
// (brighter for harder plucks); each step outputs a sample and replaces it
// with the decayed average of two neighbours (a one-zero low-pass in the loop).

class Pluck extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.port.onmessage = ({ data }) => {
      if (data.type !== "pluck") return;
      const n = Math.max(2, Math.round(sampleRate / data.freq));
      const buf = new Float32Array(n);
      // softer plucks = darker excitation (low-passed noise)
      const bright = 0.35 + 0.65 * data.velocity;
      let prev = 0;
      for (let i = 0; i < n; i++) {
        const white = Math.random() * 2 - 1;
        prev = prev + bright * (white - prev);
        buf[i] = prev * data.velocity;
      }
      this.voices.push({ buf, i: 0, decay: data.decay ?? 0.996, life: sampleRate * (data.seconds ?? 3) });
      if (this.voices.length > 24) this.voices.shift();   // voice stealing: oldest first
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    out.fill(0);
    for (let v = this.voices.length - 1; v >= 0; v--) {
      const voice = this.voices[v];
      const { buf, decay } = voice;
      const n = buf.length;
      let i = voice.i;
      for (let s = 0; s < out.length; s++) {
        const j = i + 1 === n ? 0 : i + 1;
        const y = buf[i];
        out[s] += y;
        buf[i] = decay * 0.5 * (y + buf[j]);
        i = j;
      }
      voice.i = i;
      voice.life -= out.length;
      if (voice.life <= 0) this.voices.splice(v, 1);
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor("tracked-pluck", Pluck);
