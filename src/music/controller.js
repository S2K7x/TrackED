// Music mode controller: hands → instrument logic → audio engine, plus the
// on-screen instrument overlay (frets, strings, pads, fingertip notes).
//
// Visual guides matter: free-air instruments are hard to play by ear alone
// (laser-theremin research), so every instrument shows where its notes are.

import { scaleNotes, pitchAt, noteName } from "./theory.js";
import { PinchKeys, StringCrossing, stringPositions, PadHits, drumPads, thereminControl, fingertips, sortHands } from "./instruments.js";
import { Looper } from "./looper.js";

const HARP_STRINGS = 10;
const PAD_LABELS = { kick: "Kick", snare: "Snare", hat: "Hi-hat", clap: "Clap", tom: "Tom", crash: "Crash" };

export const INSTRUMENT_HINTS = {
  theremin: "Right hand up and down plays the notes. Left hand height sets the volume.",
  keys: "Pinch your thumb with a finger to play. 4 notes per hand.",
  harp: "Sweep a fingertip across the strings to pluck them.",
  drums: "Strike the pads with a quick downward fingertip tap.",
};

export class MusicMode {
  /**
   * @param {import("./audio.js").AudioEngine} engine
   * @param {HTMLCanvasElement} overlay  2D canvas covering the video
   */
  constructor(engine, overlay) {
    this.engine = engine;
    this.overlay = overlay;
    this.ctx = overlay.getContext("2d");
    this.keys = new PinchKeys();
    this.harp = new StringCrossing(stringPositions(HARP_STRINGS));
    this.pads = drumPads();
    this.drums = new PadHits(this.pads);
    this.looper = new Looper();
    this.held = new Map();      // key → voice (sustained pinch notes)
    this.ripples = [];          // visual feedback {x, y, t, label}
    this.flash = new Map();     // string / pad index → time of last hit
    this.thereminVoice = null;
    this.theremin = { active: false };
    this.lastT = 0;
    this.s = {};
  }

  /** @param {object} s  music settings (instrument, scale, root, octave, sound, snap) */
  configure(s) {
    const changed = s.instrument !== this.s.instrument;
    this.s = { ...s };
    const root = Number(s.root), octave = Number(s.octave);
    this.keyNotes = scaleNotes(root, s.scale, octave, 8);
    this.harpNotes = scaleNotes(root, s.scale, octave - 1, HARP_STRINGS);
    const per = { pentatonic: 5, minorPenta: 5, blues: 6, major: 7, minor: 7, dorian: 7, chromatic: 12 }[s.scale] ?? 7;
    this.thereminNotes = scaleNotes(root, s.scale, octave - 1, per * 2 + 1);
    if (changed) this.release();
  }

  /** Stops every sound and forgets gesture state (mode or instrument change). */
  release() {
    for (const v of this.held.values()) v.stop();
    this.held.clear();
    this.keys.reset();
    this.harp.reset();
    this.drums.reset();
    this.thereminVoice?.stop();
    this.thereminVoice = null;
    this.theremin = { active: false };
  }

  deactivate() {
    this.release();
    this.engine.stopAll();
  }

  #play(ev, record = true, t = 0) {
    if (ev.kind === "drum") this.engine.drum(ev.name, ev.velocity);
    else this.engine.noteOn(ev.midi, { timbre: ev.timbre, velocity: ev.velocity });
    if (record) this.looper.add(ev, t);
  }

  #ripple(x, y, label, t) {
    this.ripples.push({ x, y, label, t });
    if (this.ripples.length > 40) this.ripples.shift();
  }

  /** Loop playback; call every rendered frame (independent of tracking). */
  tick(t) {
    for (const ev of this.looper.due(t)) this.#play(ev, false);
  }

  /**
   * Gestures → notes. Call on EVERY tracking result, as soon as it arrives
   * (not at render time): no gesture is missed when rendering is slow, and no
   * note waits for the next drawn frame.
   * @param hands display-space landmarks
   * @returns {string} what the status line should say
   */
  update(hands, t, aspect = 16 / 9) {
    const dt = this.lastT ? Math.min(0.2, t - this.lastT) : 0;
    this.lastT = t;
    const timbre = this.s.sound;

    switch (this.s.instrument) {
      case "keys": {
        const { pressed, released } = this.keys.update(hands, aspect);
        const sorted = sortHands(hands);
        for (const key of pressed) {
          const midi = this.keyNotes[key];
          // pinch notes sustain while held (except plucks)
          this.held.get(key)?.stop();
          this.held.set(key, this.engine.noteOn(midi, { timbre, velocity: 0.8, hold: timbre !== "pluck" }));
          this.looper.add({ kind: "note", midi, timbre, velocity: 0.8 }, t);
          const lm = sorted[Math.floor(key / 4)];
          const tip = lm?.[[8, 12, 16, 20][key % 4]];
          if (tip) this.#ripple(tip.x, tip.y, noteName(midi), t);
        }
        for (const key of released) { this.held.get(key)?.stop(); this.held.delete(key); }
        break;
      }
      case "harp": {
        for (const p of this.harp.update(fingertips(hands, [8, 12]), dt)) {
          const midi = this.harpNotes[p.string];
          this.#play({ kind: "note", midi, timbre: timbre === "pad" ? "pluck" : timbre, velocity: p.velocity }, true, t);
          this.flash.set(`s${p.string}`, t);
          this.#ripple(this.harp.xs[p.string], p.y, noteName(midi), t);
        }
        break;
      }
      case "drums": {
        for (const h of this.drums.update(fingertips(hands, [8, 12]), dt)) {
          const pad = this.pads[h.pad];
          this.#play({ kind: "drum", name: pad.name, velocity: h.velocity }, true, t);
          this.flash.set(`p${h.pad}`, t);
          this.#ripple(pad.x + pad.w / 2, pad.y + pad.h / 2, PAD_LABELS[pad.name], t);
        }
        break;
      }
      default: { // theremin
        const c = thereminControl(hands);
        this.theremin = c;
        if (c.active) {
          this.thereminVoice ??= this.engine.theremin();
          const snap = { locked: 1, soft: 0.6, free: 0 }[this.s.snap] ?? 1;
          const p = pitchAt(c.pitch, this.thereminNotes, snap);
          this.theremin.note = p;
          this.thereminVoice?.update(p.midi, c.volume);
        } else if (this.thereminVoice) {
          this.thereminVoice.stop();
          this.thereminVoice = null;
        }
      }
    }
    if (!hands.length) return "Show your hands to play";
    return INSTRUMENT_HINTS[this.s.instrument] ?? "";
  }

  // ---------------- Looper controls ----------------
  /** Record → play → clear, cycling. @returns {"recording"|"playing"|"idle"} */
  toggleLoop(t) {
    if (this.looper.state === "idle") this.looper.record(t);
    else if (this.looper.state === "recording") this.looper.play(t);
    else this.looper.clear();
    return this.looper.state;
  }

  // ---------------- Overlay ----------------
  /**
   * Draws the instrument over the video. Canvas size = stage CSS size × dpr.
   * @param {object} o  {hands, t, accent (css colour), w, h}
   */
  draw({ hands, t, accent, w, h }) {
    const g = this.ctx, X = (x) => x * w, Y = (y) => y * h;
    g.clearRect(0, 0, w, h);
    g.lineCap = "round";
    g.font = `${Math.max(11, Math.round(h * 0.022))}px Urbanist, system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const glow = (color, blur) => { g.shadowColor = color; g.shadowBlur = blur; };

    if (this.s.instrument === "theremin") {
      // "visual frets": one line per scale note on the pitch side
      const n = this.thereminNotes.length;
      const active = this.theremin.active ? this.theremin.note?.index : -1;
      for (let i = 0; i < n; i++) {
        const y = Y(0.92 - (0.84 * i) / (n - 1));
        const on = i === active;
        g.strokeStyle = on ? accent : "rgba(255,255,255,.35)";
        g.lineWidth = on ? 3 : 1;
        glow(on ? accent : "transparent", on ? 14 : 0);
        g.beginPath(); g.moveTo(X(0.55), y); g.lineTo(X(0.97), y); g.stroke();
        glow("transparent", 0);
        g.fillStyle = on ? "#fff" : "rgba(255,255,255,.7)";
        g.fillText(noteName(this.thereminNotes[i]), X(0.52), y);
      }
      // volume meter on the left
      const vol = this.theremin.active ? this.theremin.volume : 0;
      g.fillStyle = "rgba(255,255,255,.18)";
      g.fillRect(X(0.04), Y(0.2), X(0.018), Y(0.6));
      g.fillStyle = accent;
      g.fillRect(X(0.04), Y(0.2 + 0.6 * (1 - vol)), X(0.018), Y(0.6 * vol));
      g.fillStyle = "rgba(255,255,255,.75)";
      g.fillText("Volume", X(0.05), Y(0.86));
      if (this.theremin.active) {
        glow(accent, 20);
        g.fillStyle = accent;
        g.beginPath(); g.arc(X(this.theremin.x), Y(this.theremin.y), 9, 0, Math.PI * 2); g.fill();
        glow("transparent", 0);
      }
    } else if (this.s.instrument === "harp") {
      this.harp.xs.forEach((x, i) => {
        const age = t - (this.flash.get(`s${i}`) ?? -9);
        const vib = age < 0.6 ? Math.sin(age * 90) * 6 * (1 - age / 0.6) : 0;   // decaying wobble
        g.strokeStyle = age < 0.3 ? accent : "rgba(255,255,255,.55)";
        g.lineWidth = age < 0.3 ? 3 : 1.5;
        glow(age < 0.3 ? accent : "transparent", 12);
        g.beginPath();
        g.moveTo(X(x), Y(0.08));
        g.quadraticCurveTo(X(x) + vib, Y(0.5), X(x), Y(0.92));
        g.stroke();
        glow("transparent", 0);
        g.fillStyle = "rgba(255,255,255,.8)";
        g.fillText(noteName(this.harpNotes[i]), X(x), Y(0.96));
      });
    } else if (this.s.instrument === "drums") {
      this.pads.forEach((p, i) => {
        const age = t - (this.flash.get(`p${i}`) ?? -9);
        const hit = Math.max(0, 1 - age / 0.25);
        g.fillStyle = `rgba(255,255,255,${0.12 + 0.35 * hit})`;
        g.strokeStyle = hit > 0 ? accent : "rgba(255,255,255,.55)";
        g.lineWidth = 2;
        glow(hit > 0 ? accent : "transparent", 24 * hit);
        g.beginPath(); g.roundRect(X(p.x), Y(p.y), X(p.w), Y(p.h), 16); g.fill(); g.stroke();
        glow("transparent", 0);
        g.fillStyle = "#fff";
        g.fillText(PAD_LABELS[p.name], X(p.x + p.w / 2), Y(p.y + p.h / 2));
      });
    }

    // fingertips (and note labels for the pinch keys)
    sortHands(hands).slice(0, 2).forEach((lm, side) => {
      [8, 12, 16, 20].forEach((tip, f) => {
        const key = side * 4 + f, p = lm[tip];
        const down = this.s.instrument === "keys" && this.keys.down.has(key);
        g.fillStyle = down ? accent : "rgba(255,255,255,.9)";
        glow(down ? accent : "transparent", down ? 16 : 0);
        g.beginPath(); g.arc(X(p.x), Y(p.y), down ? 9 : 5, 0, Math.PI * 2); g.fill();
        glow("transparent", 0);
        if (this.s.instrument === "keys") {
          g.fillStyle = "#fff";
          g.fillText(noteName(this.keyNotes[key]), X(p.x), Y(p.y) - 16);
        }
      });
      if (this.s.instrument === "keys") {
        g.fillStyle = "rgba(255,255,255,.9)";
        g.beginPath(); g.arc(X(lm[4].x), Y(lm[4].y), 6, 0, Math.PI * 2); g.fill();
      }
    });

    // ripples: an expanding ring + the note name for every note played
    this.ripples = this.ripples.filter((r) => t - r.t < 0.7);
    for (const r of this.ripples) {
      const k = (t - r.t) / 0.7;
      g.strokeStyle = accent;
      g.globalAlpha = 1 - k;
      g.lineWidth = 3 * (1 - k) + 1;
      g.beginPath(); g.arc(X(r.x), Y(r.y), 12 + 50 * k, 0, Math.PI * 2); g.stroke();
      g.fillStyle = "#fff";
      g.fillText(r.label, X(r.x), Y(r.y) - 24 - 20 * k);
      g.globalAlpha = 1;
    }
  }
}
