// Music mode controller: hands → instruments → audio engine, the backing band,
// lessons, and the on-screen instrument overlay.
//
// Timing:
//  - gestures are handled in update(), called on EVERY tracking result
//  - band / arpeggio / sequencer / metronome / rhythm lessons run on a StepClock:
//    a 25 ms timer schedules every step of the next 120 ms on the audio clock
//    ("A tale of two clocks"), so the groove never drifts or stutters
//  - drawing and loop playback run in the render loop

import { scaleNotes, pitchAt, noteName, chordOn, PROGRESSIONS } from "./theory.js";
import { PinchKeys, StringCrossing, stringPositions, PadHits, drumPads, thereminControl, fingertips, sortHands, fingerCount, StrumLine, StepGrid } from "./instruments.js";
import { Looper } from "./looper.js";
import { StepClock } from "./scheduler.js";
import { STYLES, bandStep, chordForBar, metronomeStep } from "./band.js";
import { SongLesson, RhythmLesson, SkillLesson, RHYTHMS } from "./lessons.js";
import { SONGS } from "./songs.js";
import { fitToNotes } from "./melody-import.js";

const HARP_STRINGS = 10;
const PAD_LABELS = { kick: "Kick", snare: "Snare", hat: "Hi-hat", clap: "Clap", tom: "Tom", crash: "Crash" };

export const INSTRUMENT_HINTS = {
  theremin: "Right hand up and down plays the notes. Left hand height sets the volume.",
  keys: "Pinch your thumb with a finger to play. 4 notes per hand.",
  harp: "Sweep a fingertip across the strings to pluck them.",
  drums: "Strike the pads with a quick downward fingertip tap.",
  chords: "Left hand: show 1–4 fingers to pick a chord. Right index: strum across the line.",
  arp: "Left hand fingers pick the chord. Raise your right hand: higher = faster arpeggio.",
  beats: "Point at a cell with your right index and pinch your thumb to switch it on or off.",
  dj: "Right hand: left–right opens the filter, up adds echo. Pinch your left hand to drop the drums.",
};

/** Settings a song / rhythm lesson needs (applied by the app before starting). */
export function lessonSettings(kind, id, song) {
  if (kind === "rhythm") return { instrument: "drums" };
  const instrument = id?.startsWith("harp:") ? "harp" : id?.startsWith("theremin:") ? "theremin" : "keys";
  // imported melodies are stored in C major or C minor (melody-import.js)
  return { instrument, scale: song?.scale ?? "major", root: "0", octave: instrument === "harp" ? "5" : "4", snap: "locked" };
}

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
    this.strum = new StrumLine(0.55);
    this.grid = new StepGrid();
    this.gridPinch = new PinchKeys();      // right-hand index pinch toggles cells
    this.djPinch = new PinchKeys();
    this.looper = new Looper();
    this.clock = new StepClock({ bpm: 100 });
    this.held = new Map();
    this.ripples = [];
    this.flash = new Map();
    this.thereminVoice = null;
    this.theremin = { active: false };
    this.chordIndex = 0;
    this.arp = { active: false, rate: 2, octave: 0, i: 0 };
    this.dj = { cutoff: 1, echo: 0, drop: false, active: false };
    this.lesson = null;           // {kind: "song"|"rhythm"|"skill", obj, ...}
    this.customSongs = [];        // "Your melody" imports (set by the app)
    this.onLessonChange = () => {};
    this.lastT = 0;
    this.s = {};
    this.timer = null;
  }

  /** @param {object} s  all settings (music keys are read) */
  configure(s) {
    const instrumentChanged = s.instrument !== this.s.instrument;
    this.s = { ...s };
    const root = Number(s.root), octave = Number(s.octave);
    this.keyNotes = scaleNotes(root, s.scale, octave, 8);
    this.harpNotes = scaleNotes(root, s.scale, octave - 1, HARP_STRINGS);
    const per = { pentatonic: 5, minorPenta: 5, blues: 6, major: 7, minor: 7, dorian: 7, chromatic: 12 }[s.scale] ?? 7;
    this.thereminNotes = scaleNotes(root, s.scale, octave - 1, per * 2 + 1);
    const degrees = (PROGRESSIONS[s.progression] || PROGRESSIONS.pop).degrees;
    this.chords = [...new Set(degrees)].slice(0, 4).map((d) => chordOn(root, s.scale, d, octave - 1));
    const style = this.bandStyle;
    this.clock.setBpm(s.tempo === "auto" || !s.tempo ? (STYLES[style]?.bpm ?? 100) : Number(s.tempo));
    if (instrumentChanged) {
      this.release();
      if (this.s.instrument !== "dj") { this.engine.setFilter(1, 0); this.engine.setEcho(s.echo === "on"); }
    }
    this.#ensureClock();
  }

  /** The band plays when a style is picked, and always in DJ mode. */
  get bandStyle() {
    if (this.s.style && this.s.style !== "off") return this.s.style;
    return this.s.instrument === "dj" ? "house" : "off";
  }

  #needsClock() {
    return this.bandStyle !== "off" || this.s.metronome === "on" || ["arp", "beats"].includes(this.s.instrument) || this.lesson?.kind === "rhythm";
  }

  #ensureClock() {
    const need = this.#needsClock();
    if (need && !this.clock.running && this.engine.ready) {
      this.clock.start(this.engine.ctx.currentTime, 0.1);
      clearInterval(this.timer);
      this.timer = setInterval(() => this.#schedule(), 25);
    } else if (!need && this.clock.running) {
      this.clock.stop();
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  #schedule() {
    if (!this.engine.ready) return;
    const now = this.engine.ctx.currentTime;
    for (const { step, time } of this.clock.collect(now)) {
      const style = this.bandStyle;
      if (style !== "off") {
        for (const ev of bandStep(step, { style, root: this.s.root, scale: this.s.scale, progression: this.s.progression })) {
          if (ev.kind === "drum") {
            if (this.dj.drop && this.s.instrument === "dj") continue;
            this.engine.drum(ev.name, ev.velocity, { kit: this.s.kit === "auto" ? ev.kit : this.s.kit, when: time });
          } else this.engine.noteOn(ev.midi, { timbre: ev.timbre, velocity: ev.velocity, when: time, duration: ev.duration });
        }
      }
      const m = metronomeStep(step);
      if (m && (this.s.metronome === "on" || this.lesson?.kind === "rhythm")) this.engine.click(time, m.accent);
      if (this.s.instrument === "beats" && step % 2 === 0) {
        const col = (step / 2) % this.grid.cols;
        for (const name of this.grid.column(col)) this.engine.drum(name, 0.85, { kit: this.s.kit === "auto" ? "electro" : this.s.kit, when: time });
        this.playhead = { col, time };
      }
      if (this.s.instrument === "arp" && this.arp.active && step % this.arp.rate === 0) {
        const chord = this.chords[this.chordIndex] ?? this.chords[0];
        const seq = [...chord.notes, ...chord.notes.map((n) => n + 12)];
        const midi = seq[this.arp.i++ % seq.length] + 12 * this.arp.octave;
        this.engine.noteOn(midi, { timbre: this.s.sound, velocity: 0.7, when: time, duration: this.clock.stepDur * this.arp.rate * 0.9 });
        this.#feed({ note: midi, chord: chord.name });
      }
    }
  }

  /** Stops every sound and forgets gesture state (mode or instrument change). */
  release() {
    for (const v of this.held.values()) v.stop();
    this.held.clear();
    for (const g of [this.keys, this.harp, this.drums, this.strum, this.gridPinch, this.djPinch]) g.reset();
    this.thereminVoice?.stop();
    this.thereminVoice = null;
    this.theremin = { active: false };
    this.arp.active = false;
    this.dj = { cutoff: 1, echo: 0, drop: false, active: false };
  }

  deactivate() {
    this.release();
    this.stopLesson();
    this.clock.stop();
    clearInterval(this.timer);
    this.timer = null;
    this.engine.setFilter(1, 0);
    this.engine.stopAll();
  }

  // ---------------- Playing ----------------
  #play(ev, t, record = true) {
    if (ev.kind === "drum") this.engine.drum(ev.name, ev.velocity, { kit: this.s.kit === "auto" ? "acoustic" : this.s.kit });
    else this.engine.noteOn(ev.midi, { timbre: ev.timbre, velocity: ev.velocity });
    if (record) this.looper.add(ev, t);
    this.#feed(ev.kind === "drum" ? { drum: ev.name } : { note: ev.midi, velocity: ev.velocity });
  }

  #ripple(x, y, label, t, good = true) {
    this.ripples.push({ x, y, label, t, good });
    if (this.ripples.length > 40) this.ripples.shift();
  }

  /**
   * Gestures → notes. Call on EVERY tracking result, as soon as it arrives.
   * @returns {string} what the status line should say
   */
  update(hands, t, aspect = 16 / 9) {
    const dt = this.lastT ? Math.min(0.2, t - this.lastT) : 0;
    this.lastT = t;
    const timbre = this.s.sound;
    const sorted = sortHands(hands);

    switch (this.s.instrument) {
      case "keys": {
        const { pressed, released } = this.keys.update(hands, aspect);
        for (const key of pressed) {
          const midi = this.keyNotes[key];
          this.held.get(key)?.stop();
          this.held.set(key, this.engine.noteOn(midi, { timbre, velocity: 0.8, hold: timbre !== "pluck" && timbre !== "marimba" }));
          this.looper.add({ kind: "note", midi, timbre, velocity: 0.8 }, t);
          const ok = this.#feed({ note: midi, velocity: 0.8 });
          const tip = sorted[Math.floor(key / 4)]?.[[8, 12, 16, 20][key % 4]];
          if (tip) this.#ripple(tip.x, tip.y, noteName(midi), t, ok);
        }
        for (const key of released) { this.held.get(key)?.stop(); this.held.delete(key); }
        break;
      }
      case "harp": {
        for (const p of this.harp.update(fingertips(hands, [8, 12]), dt)) {
          const midi = this.harpNotes[p.string];
          const ev = { kind: "note", midi, timbre: ["pad", "strings", "choir", "organ"].includes(timbre) ? "pluck" : timbre, velocity: p.velocity };
          this.engine.noteOn(ev.midi, { timbre: ev.timbre, velocity: ev.velocity });
          this.looper.add(ev, t);
          const ok = this.#feed({ note: midi, velocity: p.velocity });
          this.flash.set(`s${p.string}`, t);
          this.#ripple(this.harp.xs[p.string], p.y, noteName(midi), t, ok);
        }
        break;
      }
      case "drums": {
        for (const h of this.drums.update(fingertips(hands, [8, 12]), dt)) {
          const pad = this.pads[h.pad];
          this.#play({ kind: "drum", name: pad.name, velocity: h.velocity }, t);
          this.flash.set(`p${h.pad}`, t);
          let label = PAD_LABELS[pad.name], ok = true;
          if (this.lesson?.kind === "rhythm") {
            const r = this.lesson.obj.hit(pad.name, this.engine.ctx.currentTime);
            label = r === "extra" ? label : r[0].toUpperCase() + r.slice(1);
            ok = r === "perfect" || r === "good";
            this.onLessonChange();
          }
          this.#ripple(pad.x + pad.w / 2, pad.y + pad.h / 2, label, t, ok);
        }
        break;
      }
      case "chords": {
        // left hand (or the only hand while it isn't strumming) picks the chord by finger count
        const left = sorted.length > 1 ? sorted[0] : null;
        if (left) {
          const n = fingerCount(left, aspect);
          if (n >= 1 && n <= 4) this.chordIndex = Math.min(this.chords.length - 1, n - 1);
        }
        const right = sorted[sorted.length - 1];
        const s = this.strum.update(right?.[8], dt);
        if (s) {
          const chord = this.chords[this.chordIndex];
          const notes = s.dir === "down" ? chord.notes : [...chord.notes].reverse();
          const now = this.engine.ctx.currentTime;
          notes.concat(s.dir === "down" ? [chord.notes[0] + 12] : []).forEach((midi, i) => {
            this.engine.noteOn(midi, { timbre: timbre === "glass" ? "pluck" : timbre, velocity: s.velocity * (1 - i * 0.08), when: now + i * 0.018 });
          });
          this.looper.add({ kind: "note", midi: chord.notes[0], timbre, velocity: s.velocity }, t);
          this.#feed({ chord: chord.name, note: chord.notes[0] });
          this.flash.set("strum", t);
          this.#ripple(right[8].x, this.strum.y, chord.name, t);
        }
        break;
      }
      case "arp": {
        const left = sorted.length > 1 ? sorted[0] : null;
        if (left) {
          const n = fingerCount(left, aspect);
          if (n >= 1 && n <= 4) this.chordIndex = Math.min(this.chords.length - 1, n - 1);
        }
        const right = sorted.length ? sorted[sorted.length - 1] : null;
        this.arp.active = !!right && (sorted.length > 1 || right[0].x > 0.4);
        if (right) {
          const y = right[8].y;
          this.arp.rate = y < 0.35 ? 1 : y < 0.6 ? 2 : 4;      // 16ths, 8ths, quarters
          this.arp.octave = y < 0.25 ? 1 : 0;
          this.arp.y = y;
        }
        break;
      }
      case "beats": {
        const right = sorted[sorted.length - 1];
        if (right) {
          const { pressed } = this.gridPinch.update([right], aspect);
          if (pressed.includes(0) || pressed.includes(4)) {
            const on = this.grid.toggleAt(right[8]);
            if (on !== null) {
              this.#feed({ toggle: on });
              const c = this.grid.cellAt(right[8]);
              if (on) this.engine.drum(this.grid.rows[c.row], 0.8, { kit: this.s.kit === "auto" ? "electro" : this.s.kit });
              this.#ripple(right[8].x, right[8].y, on ? "On" : "Off", t);
            }
          }
          this.gridCursor = right[8];
        } else { this.gridPinch.reset(); this.gridCursor = null; }
        break;
      }
      case "dj": {
        const right = sorted.length ? sorted[sorted.length - 1] : null;
        const left = sorted.length > 1 ? sorted[0] : null;
        if (right) {
          this.dj.cutoff = Math.max(0, Math.min(1, (right[8].x - 0.45) / 0.5));
          this.dj.echo = Math.max(0, Math.min(1, (0.75 - right[8].y) / 0.6));
          this.engine.setFilter(this.dj.cutoff, this.dj.echo * 0.4);
          this.engine.setEchoAmount(this.dj.echo * 0.55);
          this.#feed({ filter: this.dj.cutoff, echo: this.dj.echo });
        }
        const wasDrop = this.dj.drop;
        this.djPinch.update(left ? [left] : [], aspect);
        this.dj.drop = this.djPinch.down.has(0);
        if (this.dj.drop && !wasDrop) this.#feed({ drop: true });
        this.dj.active = !!right;
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
          this.#feed({ volume: c.volume });
          // a theremin "note" = staying on a scale note for 150 ms
          const n = this.thereminNotes[p.index];
          if (n !== this.thereminHold?.midi) this.thereminHold = { midi: n, since: t, sent: false };
          else if (!this.thereminHold.sent && t - this.thereminHold.since > 0.15 && c.volume > 0.15) {
            this.thereminHold.sent = true;
            const ok = this.#feed({ note: n, velocity: c.volume });
            if (this.lesson?.kind === "song") this.#ripple(c.x, c.y, noteName(n), t, ok);
          }
        } else if (this.thereminVoice) {
          this.thereminVoice.stop();
          this.thereminVoice = null;
        }
      }
    }
    if (!hands.length) return "Show your hands to play";
    return this.lesson ? "" : INSTRUMENT_HINTS[this.s.instrument] ?? "";
  }

  /** Loop playback + lesson upkeep; call every rendered frame. */
  tick(t) {
    for (const ev of this.looper.due(t)) this.#play(ev, t, false);
    if (this.lesson?.kind === "rhythm" && this.engine.ready) {
      const over = this.lesson.obj.sweep(this.engine.ctx.currentTime);
      if (over && !this.lesson.finished) { this.lesson.finished = true; this.onLessonChange(); }
    }
  }

  // ---------------- Lessons ----------------
  /** Feeds a played event to the current lesson. @returns {boolean} false if it was a wrong note */
  #feed(ev) {
    const L = this.lesson;
    if (!L) return true;
    if (L.kind === "song" && ev.note != null) {
      const r = L.obj.play(ev.note);
      if (r === "done") L.finished = true;
      this.onLessonChange();
      return r !== "wrong";
    }
    if (L.kind === "skill") {
      if (L.obj.record(ev, { band: this.bandStyle !== "off", lowest: this.thereminNotes?.[0] })) {
        if (L.obj.done) L.finished = true;
        this.onLessonChange();
      }
    }
    return true;
  }

  findSong(id) {
    const bare = id.replace(/^\w+:/, "");
    return SONGS.find((s) => s.id === bare) ?? this.customSongs.find((s) => s.id === bare) ?? null;
  }

  startSong(id) {
    let song = this.findSong(id);
    if (!song) return;
    if (song.custom) {
      // fold the imported melody into what the current instrument can play
      const avail = { harp: this.harpNotes, theremin: this.thereminNotes }[this.s.instrument] ?? this.keyNotes;
      song = { ...song, notes: fitToNotes(song.notes, avail).notes };
    }
    this.lesson = { kind: "song", obj: new SongLesson(song), id };
    this.onLessonChange();
  }

  startSkills() {
    this.lesson = { kind: "skill", obj: new SkillLesson(this.s.instrument), id: `skill:${this.s.instrument}` };
    this.onLessonChange();
  }

  startRhythm(id) {
    const r = RHYTHMS.find((x) => x.id === id);
    if (!r || !this.engine.ready) return;
    this.clock.setBpm(r.bpm);
    this.lesson = { kind: "rhythm", id, obj: null };
    this.#ensureClock();
    // one bar of count-in clicks, then the pattern starts on the next bar line
    const step = this.clock.stepDur, now = this.engine.ctx.currentTime;
    const nextBar = this.clock.next + ((16 - (this.clock.step % 16)) % 16) * step;
    const start = nextBar - now < 1 ? nextBar + 16 * step : nextBar;
    this.lesson.obj = new RhythmLesson(r, start);
    this.onLessonChange();
  }

  stopLesson() {
    if (!this.lesson) return;
    const wasRhythm = this.lesson.kind === "rhythm";
    this.lesson = null;
    if (wasRhythm) this.configure(this.s);   // back to the chosen tempo
    this.#ensureClock();
    this.onLessonChange();
  }

  /** Plays a song's melody once so learners hear it first. */
  previewSong(id, bpm) {
    const song = this.lesson?.kind === "song" && this.lesson.id === id ? this.lesson.obj.song : this.findSong(id);
    if (!song || !this.engine.ready) return 0;
    bpm ??= song.bpm ?? 96;
    const beat = 60 / bpm;
    let t = this.engine.ctx.currentTime + 0.1;
    // long imports: hear the opening phrase only
    for (const [midi, beats] of song.custom ? song.notes.slice(0, 16) : song.notes) {
      this.engine.noteOn(midi, { timbre: "glass", velocity: 0.7, when: t, duration: beats * beat * 0.9 });
      t += beats * beat;
    }
    return t - this.engine.ctx.currentTime;
  }

  /** Data for the lesson card. */
  lessonView() {
    const L = this.lesson;
    if (!L) return null;
    if (L.kind === "song") {
      const o = L.obj;
      return {
        title: o.song.title,
        subtitle: o.song.origin,
        text: L.finished ? `Well played! ${o.mistakes} wrong note${o.mistakes === 1 ? "" : "s"}.` : `Play ${noteName(o.target)}, the highlighted note. The song waits for you.`,
        progress: o.progress,
        upcoming: L.finished ? [] : o.upcoming(6).map(noteName),
        stars: L.finished ? o.stars : 0,
        finished: !!L.finished,
      };
    }
    if (L.kind === "rhythm") {
      const o = L.obj, r = RHYTHMS.find((x) => x.id === L.id);
      const now = this.engine.ctx?.currentTime ?? 0;
      const sc = o?.score ?? { perfect: 0, good: 0, miss: 0 };
      return {
        title: r.title,
        subtitle: `${r.bpm} BPM · ${r.bars} bars`,
        text: L.finished ? `Accuracy ${Math.round(o.accuracy * 100)}% · ${sc.perfect} perfect, ${sc.good} good, ${sc.miss} missed`
          : o && now < o.start ? "Listen to the count-in… hit each pad when its ring closes." : `Perfect ${sc.perfect} · Good ${sc.good} · Missed ${sc.miss}`,
        progress: o ? Math.max(0, Math.min(1, (now - o.start) / (o.end - o.start))) : 0,
        upcoming: [],
        stars: L.finished ? (o.accuracy > 0.85 ? 3 : o.accuracy > 0.6 ? 2 : 1) : 0,
        finished: !!L.finished,
      };
    }
    const o = L.obj;
    return {
      title: `First steps: ${this.s.instrument}`,
      subtitle: `Step ${Math.min(o.index + 1, o.steps.length)} of ${o.steps.length}`,
      text: L.finished ? "You've got it! Try a song in the Learn tab, or turn on the Band." : o.step.text,
      progress: o.index / o.steps.length,
      upcoming: [],
      stars: L.finished ? 3 : 0,
      finished: !!L.finished,
    };
  }

  // ---------------- Looper ----------------
  toggleLoop(t) {
    if (this.looper.state === "idle") this.looper.record(t);
    else if (this.looper.state === "recording") this.looper.play(t);
    else this.looper.clear();
    return this.looper.state;
  }

  // ---------------- Overlay ----------------
  draw({ hands, t, accent, w, h }) {
    const g = this.ctx, X = (x) => x * w, Y = (y) => y * h;
    const lime = "#d4ff3a";
    g.clearRect(0, 0, w, h);
    g.lineCap = "round";
    const fs = Math.max(11, Math.round(h * 0.022));
    g.font = `${fs}px Urbanist, system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const glow = (color, blur) => { g.shadowColor = color; g.shadowBlur = blur; };
    const target = this.lesson?.kind === "song" && !this.lesson.finished ? this.lesson.obj.target : null;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    const ring = (x, y, r) => { g.strokeStyle = lime; g.lineWidth = 3; glow(lime, 16); g.beginPath(); g.arc(x, y, r + 4 * pulse, 0, Math.PI * 2); g.stroke(); glow("transparent", 0); };

    const inst = this.s.instrument;
    if (inst === "theremin") {
      const n = this.thereminNotes.length;
      const active = this.theremin.active ? this.theremin.note?.index : -1;
      for (let i = 0; i < n; i++) {
        const y = Y(0.92 - (0.84 * i) / (n - 1));
        const on = i === active, isTarget = this.thereminNotes[i] === target;
        g.strokeStyle = isTarget ? lime : on ? accent : "rgba(255,255,255,.35)";
        g.lineWidth = on || isTarget ? 3 : 1;
        glow(on ? accent : isTarget ? lime : "transparent", on || isTarget ? 14 : 0);
        g.beginPath(); g.moveTo(X(0.55), y); g.lineTo(X(0.97), y); g.stroke();
        glow("transparent", 0);
        g.fillStyle = on || isTarget ? "#fff" : "rgba(255,255,255,.7)";
        g.fillText(noteName(this.thereminNotes[i]), X(0.52), y);
      }
      const vol = this.theremin.active ? this.theremin.volume : 0;
      g.fillStyle = "rgba(255,255,255,.18)";
      g.fillRect(X(0.04), Y(0.2), X(0.018), Y(0.6));
      g.fillStyle = accent;
      g.fillRect(X(0.04), Y(0.2 + 0.6 * (1 - vol)), X(0.018), Y(0.6 * vol));
      g.fillStyle = "rgba(255,255,255,.75)";
      g.fillText("Volume", X(0.05), Y(0.86));
      if (this.theremin.active) { glow(accent, 20); g.fillStyle = accent; g.beginPath(); g.arc(X(this.theremin.x), Y(this.theremin.y), 9, 0, Math.PI * 2); g.fill(); glow("transparent", 0); }
    } else if (inst === "harp") {
      this.harp.xs.forEach((x, i) => {
        const age = t - (this.flash.get(`s${i}`) ?? -9);
        const vib = age < 0.6 ? Math.sin(age * 90) * 6 * (1 - age / 0.6) : 0;
        const isTarget = this.harpNotes[i] === target;
        g.strokeStyle = isTarget ? lime : age < 0.3 ? accent : "rgba(255,255,255,.55)";
        g.lineWidth = age < 0.3 || isTarget ? 3 : 1.5;
        glow(isTarget ? lime : age < 0.3 ? accent : "transparent", isTarget ? 10 + 8 * pulse : 12);
        g.beginPath(); g.moveTo(X(x), Y(0.08)); g.quadraticCurveTo(X(x) + vib, Y(0.5), X(x), Y(0.92)); g.stroke();
        glow("transparent", 0);
        g.fillStyle = isTarget ? lime : "rgba(255,255,255,.8)";
        g.fillText(noteName(this.harpNotes[i]), X(x), Y(0.96));
      });
    } else if (inst === "drums") {
      const lessonNow = this.lesson?.kind === "rhythm" && this.lesson.obj && this.engine.ready ? this.engine.ctx.currentTime : null;
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
      if (lessonNow != null) {
        // approaching rings: each one closes onto its pad exactly when it should be hit
        for (const e of this.lesson.obj.upcoming(lessonNow)) {
          const p = this.pads.find((q) => q.name === e.pad);
          if (!p) continue;
          const k = Math.max(0, (e.time - lessonNow) / 1.2);
          g.strokeStyle = lime; g.lineWidth = 3; g.globalAlpha = 1 - k * 0.6;
          g.beginPath(); g.roundRect(X(p.x - k * 0.08), Y(p.y - k * 0.08), X(p.w + k * 0.16), Y(p.h + k * 0.16), 18); g.stroke();
          g.globalAlpha = 1;
        }
      }
    } else if (inst === "chords" || inst === "arp") {
      // chord cards (top left) + strum line
      this.chords.forEach((c, i) => {
        const on = i === this.chordIndex, x = 0.04 + i * 0.11, y = 0.05;
        g.fillStyle = on ? accent : "rgba(255,255,255,.18)";
        glow(on ? accent : "transparent", on ? 14 : 0);
        g.beginPath(); g.roundRect(X(x), Y(y), X(0.095), Y(0.13), 12); g.fill();
        glow("transparent", 0);
        g.fillStyle = "#fff";
        g.font = `600 ${Math.round(fs * 1.3)}px Urbanist, system-ui, sans-serif`;
        g.fillText(c.name, X(x + 0.0475), Y(y + 0.055));
        g.font = `${fs}px Urbanist, system-ui, sans-serif`;
        g.fillText(`${i + 1} finger${i ? "s" : ""}`, X(x + 0.0475), Y(y + 0.1));
      });
      if (inst === "chords") {
        const age = t - (this.flash.get("strum") ?? -9);
        g.strokeStyle = age < 0.25 ? accent : "rgba(255,255,255,.6)";
        g.lineWidth = age < 0.25 ? 4 : 2;
        g.setLineDash([10, 8]);
        g.beginPath(); g.moveTo(X(0.5), Y(this.strum.y)); g.lineTo(X(0.97), Y(this.strum.y)); g.stroke();
        g.setLineDash([]);
        g.fillStyle = "rgba(255,255,255,.8)";
        g.fillText("Strum ↕", X(0.735), Y(this.strum.y) - 16);
      } else {
        for (const [y, label] of [[0.35, "Fast"], [0.6, "Medium"], [0.92, "Slow"]]) {
          g.fillStyle = "rgba(255,255,255,.7)";
          g.fillText(label, X(0.95), Y(y - 0.06));
          g.strokeStyle = "rgba(255,255,255,.25)"; g.lineWidth = 1;
          g.beginPath(); g.moveTo(X(0.6), Y(y)); g.lineTo(X(0.98), Y(y)); g.stroke();
        }
      }
    } else if (inst === "beats") {
      const { x, y, w: gw, h: gh } = this.grid.area;
      const cw = gw / this.grid.cols, ch = gh / this.grid.rows.length;
      const now = this.engine.ctx?.currentTime ?? 0;
      const playing = this.playhead && now >= this.playhead.time ? this.playhead.col : -1;
      const hover = this.gridCursor ? this.grid.cellAt(this.gridCursor) : null;
      this.grid.rows.forEach((name, r) => {
        g.fillStyle = "rgba(255,255,255,.8)";
        g.textAlign = "right";
        g.fillText(PAD_LABELS[name], X(x) - 8, Y(y + ch * (r + 0.5)));
        g.textAlign = "center";
        for (let c = 0; c < this.grid.cols; c++) {
          const on = this.grid.cells[r][c], isHover = hover && hover.row === r && hover.col === c;
          g.fillStyle = on ? (c === playing ? "#fff" : accent) : c === playing ? "rgba(255,255,255,.3)" : "rgba(255,255,255,.12)";
          g.strokeStyle = isHover ? lime : "rgba(255,255,255,.35)";
          g.lineWidth = isHover ? 3 : 1;
          g.beginPath(); g.roundRect(X(x + c * cw) + 3, Y(y + r * ch) + 3, X(cw) - 6, Y(ch) - 6, 8); g.fill(); g.stroke();
        }
      });
      for (let c = 0; c < this.grid.cols; c += 2) { g.fillStyle = "rgba(255,255,255,.6)"; g.fillText(String(c / 2 + 1), X(x + (c + 0.5) * cw), Y(y + gh) + 14); }
    } else if (inst === "dj") {
      // filter / echo pad on the right
      g.strokeStyle = "rgba(255,255,255,.4)"; g.lineWidth = 1.5;
      g.beginPath(); g.roundRect(X(0.45), Y(0.15), X(0.5), Y(0.6), 18); g.stroke();
      g.fillStyle = "rgba(255,255,255,.75)";
      g.fillText("← Filter →", X(0.7), Y(0.79));
      g.save(); g.translate(X(0.97), Y(0.45)); g.rotate(-Math.PI / 2); g.fillText("Echo →", 0, 0); g.restore();
      if (this.dj.active) {
        const cx = 0.45 + this.dj.cutoff * 0.5, cy = 0.75 - this.dj.echo * 0.6;
        glow(accent, 22); g.fillStyle = accent; g.beginPath(); g.arc(X(cx), Y(cy), 12, 0, Math.PI * 2); g.fill(); glow("transparent", 0);
      }
      g.fillStyle = this.dj.drop ? accent : "rgba(255,255,255,.75)";
      g.font = `600 ${Math.round(fs * 1.2)}px Urbanist, system-ui, sans-serif`;
      g.fillText(this.dj.drop ? "DROP!" : "Pinch left hand = drop", X(0.2), Y(0.5));
      g.font = `${fs}px Urbanist, system-ui, sans-serif`;
    }

    // fingertips (+ note labels and the lesson target for pinch keys)
    sortHands(hands).slice(0, 2).forEach((lm, side) => {
      [8, 12, 16, 20].forEach((tip, f) => {
        const key = side * 4 + f, p = lm[tip];
        if (!p) return;
        const down = inst === "keys" && this.keys.down.has(key);
        g.fillStyle = down ? accent : "rgba(255,255,255,.9)";
        glow(down ? accent : "transparent", down ? 16 : 0);
        g.beginPath(); g.arc(X(p.x), Y(p.y), down ? 9 : 5, 0, Math.PI * 2); g.fill();
        glow("transparent", 0);
        if (inst === "keys") {
          const isTarget = this.keyNotes[key] === target;
          if (isTarget) ring(X(p.x), Y(p.y), 14);
          g.fillStyle = isTarget ? lime : "#fff";
          g.fillText(noteName(this.keyNotes[key]), X(p.x), Y(p.y) - 18);
        }
      });
      if (inst === "keys" && lm[4]) { g.fillStyle = "rgba(255,255,255,.9)"; g.beginPath(); g.arc(X(lm[4].x), Y(lm[4].y), 6, 0, Math.PI * 2); g.fill(); }
    });

    // ripples: an expanding ring + label for every note (red-ish when it was the wrong lesson note)
    this.ripples = this.ripples.filter((r) => t - r.t < 0.7);
    for (const r of this.ripples) {
      const k = (t - r.t) / 0.7;
      g.strokeStyle = r.good ? accent : "#ff6b6b";
      g.globalAlpha = 1 - k;
      g.lineWidth = 3 * (1 - k) + 1;
      g.beginPath(); g.arc(X(r.x), Y(r.y), 12 + 50 * k, 0, Math.PI * 2); g.stroke();
      g.fillStyle = "#fff";
      g.fillText(r.label, X(r.x), Y(r.y) - 24 - 20 * k);
      g.globalAlpha = 1;
    }

    // loop progress ring (bottom right)
    if (this.looper.state !== "idle") {
      const p = this.looper.progress(t);
      g.strokeStyle = "rgba(255,255,255,.3)"; g.lineWidth = 5;
      g.beginPath(); g.arc(X(0.94), Y(0.9), 16, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = this.looper.state === "recording" ? "#ff3b30" : lime;
      g.beginPath(); g.arc(X(0.94), Y(0.9), 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (this.looper.state === "recording" ? 1 : p)); g.stroke();
    }
  }
}

export { SONGS, RHYTHMS, chordForBar };
