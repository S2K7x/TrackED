// Music theory helpers (pure). MIDI note numbers: C4 = 60, A4 = 69 = 440 Hz.
//
// Free-air pitch is notoriously hard to control (laser-theremin / Termenova
// research), so every instrument snaps to a scale by default: whatever the
// hands do, it stays in key.

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],          // can't play a wrong note
  minorPenta: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);

export function noteName(midi) {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/**
 * `count` ascending notes of a scale, starting on the root in the given octave.
 * @param {number} root     0..11 (0 = C)
 * @param {string} scale    key of SCALES
 * @param {number} octave   e.g. 4 → starts at C4..B4
 */
export function scaleNotes(root, scale, octave, count) {
  const steps = SCALES[scale] || SCALES.pentatonic;
  const base = 12 * (octave + 1) + root;
  const out = [];
  for (let i = 0; i < count; i++) out.push(base + 12 * Math.floor(i / steps.length) + steps[i % steps.length]);
  return out;
}

/**
 * Maps a position t ∈ [0, 1] (bottom → top) onto the note range.
 * snap = 1 → locked to the nearest scale note; 0 → fully continuous (glissando);
 * in between → a "soft" snap that pulls towards scale notes.
 * @returns {{midi: number, index: number}} midi may be fractional when snap < 1
 */
export function pitchAt(t, notes, snap = 1) {
  const u = Math.max(0, Math.min(1, t)) * (notes.length - 1);
  const index = Math.round(u);
  const lo = Math.floor(u), hi = Math.min(notes.length - 1, lo + 1);
  const continuous = notes[lo] + (notes[hi] - notes[lo]) * (u - lo);
  return { midi: continuous + (notes[index] - continuous) * snap, index };
}
