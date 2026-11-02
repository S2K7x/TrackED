// Backing band: drums + bass + chord stabs that follow a chord progression in
// the chosen key, so anything played on top sounds good. Patterns are simple,
// generic genre grooves written for this app (16 steps = one bar of 16th notes).
// Pure: returns the events for one step; the controller schedules them on the
// audio clock.

import { chordOn, PROGRESSIONS } from "./theory.js";

const P = (s) => s.split("").map((c) => (c === "x" ? 1 : c === "o" ? 0.55 : 0)); // x = accent, o = soft

export const STYLES = {
  pop: {
    label: "Pop", bpm: 100,
    kick: P("x-------x-x-----"), snare: P("----x-------x---"), hat: P("x-o-x-o-x-o-x-o-"),
    bass: P("x-----x-x-------"), stab: P("--------x-------"), kit: "acoustic",
  },
  lofi: {
    label: "Lo-fi", bpm: 78,
    kick: P("x------x--x-----"), snare: P("----x-------x--o"), hat: P("o-o-o-o-o-o-o-oo"),
    bass: P("x------x--x-----"), stab: P("x-------x-------"), kit: "lofi",
  },
  house: {
    label: "House", bpm: 124,
    kick: P("x---x---x---x---"), snare: P("----x-------x---"), hat: P("--x---x---x---x-"),
    bass: P("--x---x---x---x-"), stab: P("---x-----x------"), kit: "electro",
  },
  rock: {
    label: "Rock", bpm: 116,
    kick: P("x-----x-x-------"), snare: P("----x-------x---"), hat: P("x-x-x-x-x-x-x-x-"),
    bass: P("x-x-x-x-x-x-x-x-"), stab: P("x-------x-------"), kit: "acoustic",
  },
  reggae: {
    label: "Reggae", bpm: 76,
    kick: P("--------x-------"), snare: P("--------x-------"), hat: P("o-o-o-o-o-o-o-o-"),
    bass: P("x--x---x--x-----"), stab: P("----x-------x---"), kit: "acoustic",
  },
  hiphop: {
    label: "Hip-hop", bpm: 90,
    kick: P("x-----x---x-x---"), snare: P("----x-------x---"), hat: P("x-x-x-x-x-xxx-x-"),
    bass: P("x-----x---x-----"), stab: P("------------x---"), kit: "electro",
  },
};

/** Chord for a bar of the progression. */
export function chordForBar(bar, { root, scale, progression = "pop", octave = 3 }) {
  const degrees = (PROGRESSIONS[progression] || PROGRESSIONS.pop).degrees;
  return chordOn(Number(root), scale, degrees[bar % degrees.length], octave);
}

/**
 * Events for one 16th-note step.
 * @param {number} step  absolute step counter (16 per bar)
 * @param {{style: string, root: number|string, scale: string, progression: string}} o
 * @returns {{kind: "drum"|"note", name?: string, midi?: number, timbre?: string, velocity: number, duration?: number}[]}
 */
export function bandStep(step, o) {
  const st = STYLES[o.style];
  if (!st) return [];
  const i = step % 16, bar = Math.floor(step / 16);
  const out = [];
  const chord = chordForBar(bar, o);
  for (const name of ["kick", "snare", "hat"]) if (st[name][i]) out.push({ kind: "drum", name, velocity: 0.75 * st[name][i], kit: st.kit });
  if (i === 0 && bar % 4 === 0 && o.style !== "lofi") out.push({ kind: "drum", name: "crash", velocity: 0.35, kit: st.kit });
  if (st.bass[i]) {
    // root on strong beats, fifth as a passing note on the "and" of 3
    const midi = chord.root - 12 + (i === 10 && o.style !== "house" ? 7 : 0);
    out.push({ kind: "note", midi, timbre: "bass", velocity: 0.8 * st.bass[i], duration: 0.22 });
  }
  if (st.stab[i]) {
    for (const midi of chord.notes) out.push({ kind: "note", midi: midi + 12, timbre: o.style === "lofi" ? "epiano" : "organ", velocity: 0.35, duration: o.style === "reggae" ? 0.12 : 0.4 });
  }
  return out;
}

/** Metronome tick for a step (accented on the first beat of the bar), or null. */
export function metronomeStep(step) {
  const i = step % 16;
  return i % 4 === 0 ? { accent: i === 0 } : null;
}
