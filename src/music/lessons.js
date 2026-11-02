// Lessons (pure, unit-tested):
//  - SongLesson: "wait mode" (as in Synthesia's melody practice): the next note
//    is highlighted and the song waits until you play it. Wrong notes are
//    counted, never punished, and the score turns into 1–3 stars.
//  - RhythmLesson: play a drum pattern in time with a click. Timing windows are
//    wide on purpose: webcam tracking runs at ~30 fps, so ~33 ms of jitter is
//    already there before any sound (see docs/RESEARCH.md).
//  - SkillLesson: a few guided "first steps" per instrument.

export class SongLesson {
  /** @param {{title: string, notes: [number, number][]}} song */
  constructor(song) {
    this.song = song;
    this.index = 0;
    this.mistakes = 0;
    this.done = false;
  }

  get target() { return this.done ? null : this.song.notes[this.index][0]; }
  get progress() { return this.index / this.song.notes.length; }

  /** @returns {"correct"|"wrong"|"done"|"ignored"} */
  play(midi) {
    if (this.done) return "ignored";
    if (Math.round(midi) !== this.target) { this.mistakes++; return "wrong"; }
    this.index++;
    if (this.index >= this.song.notes.length) { this.done = true; return "done"; }
    return "correct";
  }

  /** 3 stars: ≤ 1 mistake per 8 notes; 2: ≤ 1 per 3; else 1. */
  get stars() {
    const n = this.song.notes.length;
    return this.mistakes <= n / 8 ? 3 : this.mistakes <= n / 3 ? 2 : 1;
  }

  /** The next few notes (for the "coming up" strip). */
  upcoming(k = 5) { return this.song.notes.slice(this.index, this.index + k).map(([m]) => m); }
}

export const RHYTHMS = [
  { id: "rock", title: "Basic rock beat", bpm: 80, bars: 4, pattern: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] } },
  { id: "four", title: "Four on the floor", bpm: 90, bars: 4, pattern: { kick: [0, 4, 8, 12], hat: [2, 6, 10, 14] } },
  { id: "backbeat", title: "Backbeat (2 and 4)", bpm: 70, bars: 4, pattern: { kick: [0, 8], snare: [4, 12] } },
];

/** Timing windows in seconds (wide on purpose: webcam input jitter ≈ 33 ms). */
export const WINDOWS = { perfect: 0.07, good: 0.14 };

export function judge(offsetSeconds) {
  const d = Math.abs(offsetSeconds);
  return d <= WINDOWS.perfect ? "perfect" : d <= WINDOWS.good ? "good" : "miss";
}

export class RhythmLesson {
  /**
   * @param {{bpm: number, bars: number, pattern: Record<string, number[]>}} r
   * @param {number} start  audio time of the first step
   */
  constructor(r, start) {
    this.r = r;
    this.start = start;
    const step = 60 / r.bpm / 4;
    this.expected = [];
    for (let bar = 0; bar < r.bars; bar++) {
      for (const [pad, steps] of Object.entries(r.pattern)) {
        for (const s of steps) this.expected.push({ pad, time: start + (bar * 16 + s) * step, result: null });
      }
    }
    this.expected.sort((a, b) => a.time - b.time);
    this.end = start + r.bars * 16 * step;
    this.score = { perfect: 0, good: 0, miss: 0 };
  }

  /** A hit on a pad at audio time t. @returns {"perfect"|"good"|"miss"|"extra"} */
  hit(pad, t) {
    let best = null;
    for (const e of this.expected) {
      if (e.result || e.pad !== pad) continue;
      if (!best || Math.abs(e.time - t) < Math.abs(best.time - t)) best = e;
    }
    if (!best || Math.abs(best.time - t) > WINDOWS.good) return "extra";
    best.result = judge(best.time - t);
    this.score[best.result]++;
    return best.result;
  }

  /** Marks notes whose window has passed as missed. Call regularly. */
  sweep(t) {
    for (const e of this.expected) {
      if (!e.result && t - e.time > WINDOWS.good) { e.result = "miss"; this.score.miss++; }
    }
    return t > this.end + WINDOWS.good;
  }

  /** Upcoming hits in the next `window` seconds (for the approaching rings). */
  upcoming(t, window = 1.2) {
    return this.expected.filter((e) => !e.result && e.time >= t - WINDOWS.good && e.time <= t + window);
  }

  get accuracy() {
    const n = this.expected.length;
    return n ? (this.score.perfect + 0.6 * this.score.good) / n : 0;
  }
}

/**
 * First steps per instrument: each step is checked against what was played
 * since the step started ({notes: midi[], drums: name[], chords: string[]}).
 */
export const SKILLS = {
  theremin: [
    { text: "Raise your right hand slowly: the pitch goes up the lines.", check: (h) => h.distinct >= 3 },
    { text: "Now go back down to the lowest line.", check: (h, ctx) => h.notes.includes(ctx.lowest) },
    { text: "Lift your left hand to play louder, lower it to fade out.", check: (h) => h.volumeRange >= 0.4 },
  ],
  keys: [
    { text: "Pinch your left thumb and index: that's your first note.", check: (h) => h.notes.length >= 1 },
    { text: "Play 4 different notes with one hand (index, middle, ring, pinky).", check: (h) => h.distinct >= 4 },
    { text: "Use both hands: play all 8 notes.", check: (h) => h.distinct >= 8 },
  ],
  harp: [
    { text: "Sweep one fingertip across the strings, left to right.", check: (h) => h.notes.length >= 4 },
    { text: "Pluck just one string, gently.", check: (h) => h.notes.length >= 1 },
    { text: "Sweep fast for a loud glissando.", check: (h) => h.maxVelocity >= 0.8 },
  ],
  drums: [
    { text: "Tap the Kick pad (bottom left) with a quick downward move.", check: (h) => h.drums.includes("kick") },
    { text: "Now the Snare (top middle).", check: (h) => h.drums.includes("snare") },
    { text: "Alternate: kick, snare, kick, snare.", check: (h) => h.drums.filter((d) => d === "kick").length >= 2 && h.drums.filter((d) => d === "snare").length >= 2 },
  ],
  chords: [
    { text: "Show 1 finger on your left hand, then strum down across the line with your right index.", check: (h) => h.chords.length >= 1 },
    { text: "Change chords: show 1, 2, 3 then 4 fingers, strumming each.", check: (h) => new Set(h.chords).size >= 3 },
    { text: "Turn the Band on (Band tab) and strum along with the drums.", check: (h, ctx) => ctx.band },
  ],
  arp: [
    { text: "Raise your right hand to start the arpeggio.", check: (h) => h.notes.length >= 4 },
    { text: "Change chord with your left hand's fingers (1 to 4).", check: (h) => new Set(h.chords).size >= 2 },
    { text: "Move your right hand higher for faster, higher notes.", check: (h) => h.distinct >= 8 },
  ],
  beats: [
    { text: "Point at a cell with your right index and pinch your thumb to switch it on.", check: (h) => h.toggles >= 1 },
    { text: "Build a beat: kicks on 1 and 5, snares on 3 and 7.", check: (h) => h.toggles >= 4 },
    { text: "Pinch a lit cell again to switch it off.", check: (h) => h.offs >= 1 },
  ],
  dj: [
    { text: "Move your right hand left and right: the filter opens and closes.", check: (h) => h.filterRange >= 0.5 },
    { text: "Raise your right hand for more echo.", check: (h) => h.echoMax >= 0.5 },
    { text: "Pinch with your left hand to drop the drums, release to bring them back.", check: (h) => h.drops >= 1 },
  ],
};

export class SkillLesson {
  constructor(instrument) {
    this.instrument = instrument;
    this.steps = SKILLS[instrument] ?? [];
    this.index = 0;
    this.reset();
  }

  reset() { this.h = { notes: [], drums: [], chords: [], distinct: 0, maxVelocity: 0, volumeRange: 0, volMin: 1, volMax: 0, toggles: 0, offs: 0, filterRange: 0, fMin: 1, fMax: 0, echoMax: 0, drops: 0 }; }

  get step() { return this.steps[this.index] ?? null; }
  get done() { return this.index >= this.steps.length; }

  /** Feed what happened. @returns {boolean} true when the current step was just completed */
  record(ev, ctx = {}) {
    if (this.done) return false;
    const h = this.h;
    if (ev.note != null) { h.notes.push(Math.round(ev.note)); h.distinct = new Set(h.notes).size; h.maxVelocity = Math.max(h.maxVelocity, ev.velocity ?? 0); }
    if (ev.drum) h.drums.push(ev.drum);
    if (ev.chord) h.chords.push(ev.chord);
    if (ev.volume != null) { h.volMin = Math.min(h.volMin, ev.volume); h.volMax = Math.max(h.volMax, ev.volume); h.volumeRange = h.volMax - h.volMin; }
    if (ev.toggle != null) { h.toggles++; if (!ev.toggle) h.offs++; }
    if (ev.filter != null) { h.fMin = Math.min(h.fMin, ev.filter); h.fMax = Math.max(h.fMax, ev.filter); h.filterRange = h.fMax - h.fMin; }
    if (ev.echo != null) h.echoMax = Math.max(h.echoMax, ev.echo);
    if (ev.drop) h.drops++;
    if (this.step.check(h, ctx)) { this.index++; this.reset(); return true; }
    return false;
  }
}
