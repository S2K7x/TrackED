import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMidi, midiMelody, skyline, melodyScore, yin, trackPitch, segmentNotes, guessBeat, parseNoteText,
  detectKey, notesToSteps, normalizeSteps, fitToNotes, makeCustomSong, loadCustomSongs, addCustomSong,
  melodyFileKind, cleanTitle, MELODY_LIMITS,
} from "../src/music/melody-import.js";
import { scaleNotes, SCALES } from "../src/music/theory.js";
import { SongLesson } from "../src/music/lessons.js";

// ---- a tiny MIDI writer for the tests ----
const vlq = (n) => { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (s) => [...s].map((c) => c.charCodeAt(0));
/** events: [deltaTicks, ...bytes] */
function track(events) {
  const body = events.flatMap(([d, ...bytes]) => [...vlq(d), ...bytes]).concat([0, 0xff, 0x2f, 0]);
  return [...text("MTrk"), ...u32(body.length), ...body];
}
function midiFile(tracks, { format = 1, ppq = 480 } = {}) {
  return new Uint8Array([...text("MThd"), ...u32(6), 0, format, 0, tracks.length, ppq >> 8, ppq & 255, ...tracks.flat()]);
}
const name = (s) => [0, 0xff, 0x03, s.length, ...text(s)];
const melodyEvents = (pitches, ch = 0, ticks = 480) => pitches.flatMap((p) => [[0, 0x90 | ch, p, 100], [ticks, 0x80 | ch, p, 0]]);

test("MIDI: parses notes, tempo and track names; note-on with velocity 0 ends a note", () => {
  const tempo = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20]; // 500000 µs = 120 BPM
  const t0 = track([tempo, name("Conductor")]);
  const t1 = track([name("Melody"), [0, 0x90, 60, 100], [480, 0x90, 60, 0], [0, 0x90, 62, 90], [240, 62, 0], [0, 64, 80], [960, 0x80, 64, 0]]);
  const parsed = parseMidi(midiFile([t0, t1]));
  assert.equal(parsed.bpm, 120);
  assert.equal(parsed.tracks[1].name, "Melody");
  const n = parsed.tracks[1].notes;
  assert.deepEqual(n.map((x) => x.midi), [60, 62, 64]);            // running status handled
  assert.ok(Math.abs(n[0].dur - 0.5) < 1e-6 && Math.abs(n[1].start - 0.5) < 1e-6 && Math.abs(n[2].dur - 1) < 1e-6);
});

test("MIDI: tempo changes move later notes", () => {
  const t = track([[0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20], ...melodyEvents([60]), [0, 0xff, 0x51, 3, 0x0f, 0x42, 0x40], ...melodyEvents([62])]);
  const n = parseMidi(midiFile([t], { format: 0 })).tracks[0].notes;
  assert.ok(Math.abs(n[1].start - 0.5) < 1e-6);
  assert.ok(Math.abs(n[1].dur - 1) < 1e-6);                         // 60 BPM after the change
});

test("MIDI: rejects junk and truncated files", () => {
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])), /not a MIDI/);
  const ok = midiFile([track(melodyEvents([60, 62, 64]))]);
  assert.throws(() => parseMidi(ok.subarray(0, ok.length - 10)), /cut short|damaged/);
});

test("MIDI: the melody track wins over bass, chords and drums", () => {
  const bass = track([name("Bass"), ...melodyEvents([36, 38, 40, 41, 43, 45], 1)]);
  const chords = track([name("Piano"), ...[60, 65, 67].flatMap((r) => [[0, 0x92, r, 80], [0, 0x92, r + 4, 80], [0, 0x92, r + 7, 80], [960, 0x82, r, 0], [0, 0x82, r + 4, 0], [0, 0x82, r + 7, 0]])]);
  const drums = track([...melodyEvents([76, 76, 76, 76, 76, 76], 9, 240)]);
  const tune = track([...melodyEvents([64, 62, 60, 62, 64, 64, 64], 3)]);
  const parsed = parseMidi(midiFile([bass, chords, drums, tune]));
  assert.equal(melodyScore(parsed.tracks[2]), -Infinity);         // drums only
  const m = midiMelody(parsed);
  assert.deepEqual(m.notes.map((n) => n.midi), [64, 62, 60, 62, 64, 64, 64]);
  assert.ok(Math.abs(m.beatSec - 0.5) < 1e-9);
});

test("skyline: highest of simultaneous notes, overlaps cut", () => {
  const out = skyline([
    { midi: 60, start: 0, dur: 1, channel: 0 }, { midi: 64, start: 0.01, dur: 1, channel: 0 },
    { midi: 67, start: 0.5, dur: 0.5, channel: 0 }, { midi: 40, start: 0.6, dur: 0.01, channel: 0 },
  ]);
  assert.deepEqual(out.map((n) => n.midi), [64, 67]);
  assert.ok(Math.abs(out[0].dur - 0.5) < 1e-9);
});

// ---- audio ----
const SR = 22050;
const f = (m) => 440 * 2 ** ((m - 69) / 12);
function tones(seq, gap = 0.04) {
  const total = seq.reduce((s, [, d]) => s + d + gap, 0.2);
  const x = new Float32Array(Math.ceil(total * SR));
  let t = 0.1;
  for (const [m, d] of seq) {
    const a = Math.floor(t * SR), n = Math.floor(d * SR);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / 200, (n - i) / 200);
      // a voice-like tone: fundamental + harmonics
      x[a + i] = env * (0.5 * Math.sin(2 * Math.PI * f(m) * i / SR) + 0.25 * Math.sin(4 * Math.PI * f(m) * i / SR) + 0.1 * Math.sin(6 * Math.PI * f(m) * i / SR));
    }
    t += d + gap;
  }
  return x;
}

test("YIN: finds the pitch of a harmonic tone, rejects noise", () => {
  for (const m of [48, 57, 64, 72, 81]) {
    const r = yin(tones([[m, 0.2]]), SR, { offset: 1000 + 0.1 * SR | 0 });
    assert.ok(r, `pitch for ${m}`);
    assert.ok(Math.abs(69 + 12 * Math.log2(r.freq / 440) - m) < 0.2, `${m} → ${r.freq}`);
  }
  let seed = 1;
  const noise = Float32Array.from({ length: 4000 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1);
  assert.equal(yin(noise, SR), null);
});

test("audio → notes: a sung/hummed melody comes out note for note", async () => {
  const seq = [[60, 0.4], [62, 0.4], [64, 0.4], [60, 0.4], [67, 0.8], [67, 0.4]];
  const pitch = await trackPitch(tones(seq), SR, { yieldEvery: 0 });
  const notes = segmentNotes(pitch);
  assert.deepEqual(notes.map((n) => n.midi), seq.map(([m]) => m));
  const beat = guessBeat(notes);
  assert.ok(Math.abs(beat - 0.44) < 0.03, `beat ${beat}`);
  assert.deepEqual(notesToSteps(notes, beat, 0.5).map(([, b]) => b).slice(0, 5), [1, 1, 1, 1, 2]);
});

test("audio → notes: a slight vibrato stays one note, silence gives none", () => {
  const hop = 0.012, frames = [];
  for (let i = 0; i < 60; i++) frames.push({ midi: 64 + 0.3 * Math.sin(i / 2), rms: 0.3 });
  assert.deepEqual(segmentNotes({ hop, frames }).map((n) => n.midi), [64]);
  assert.deepEqual(segmentNotes({ hop, frames: frames.map(() => ({ midi: null, rms: 0 })) }), []);
  // a 1-frame octave blip is filtered out
  frames[30] = { midi: 76, rms: 0.3 };
  assert.deepEqual(segmentNotes({ hop, frames }).map((n) => n.midi), [64]);
});

// ---- typed notes ----
test("typed notes: letters, solfège, octaves, lengths and rests", () => {
  assert.deepEqual(parseNoteText("C D E F G A B C").notes.map(([m]) => m), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.deepEqual(parseNoteText("do ré mi fa sol").notes.map(([m]) => m), [60, 62, 64, 65, 67]);
  assert.deepEqual(parseNoteText("E4:2 Eb4 C#5:0.5 - G3").notes, [[64, 2], [63, 1], [73, 1.5], [55, 1]]);
  assert.deepEqual(parseNoteText("sol, la | si").notes.map(([m]) => m), [67, 69, 71]);
  assert.deepEqual(parseNoteText("C4 hello X9 D4").errors, ["hello", "x9"]);
});

// ---- key and fit ----
test("key finding: major and minor tunes", () => {
  const g = parseNoteText("G4 A4 B4 C5 D5:2 B4 G4:2 D5 C5 B4 A4 G4:2 F#4 G4:2").notes;
  assert.deepEqual(detectKey(g), { ...detectKey(g), root: 7, mode: "major" });
  const am = parseNoteText("A4 B4 C5 D5 E5:2 C5 A4:2 E5 D5 C5 B4 A4:3 E4 A4:2").notes;
  assert.equal(detectKey(am).mode, "minor");
  assert.equal(detectKey(am).root, 9);
});

test("key finding: a tune that fits a key is never bent to another", () => {
  // A major (no G#): K-S alone said C# minor and snapped the D to C#
  const a = [[69, 1], [71, 1], [73, 1], [69, 1], [76, 2], [76, 1], [74, 1], [73, 2]];
  const n = normalizeSteps(a);
  assert.equal(n.snapped, 0);
  assert.deepEqual(n.notes.map(([m]) => m - n.notes[0][0]), a.map(([m]) => m - a[0][0]));   // same intervals
  assert.equal(normalizeSteps(parseNoteText("do ré mi fa sol:2 sol:2 la la la la sol:4").notes).snapped, 0);
  assert.equal(detectKey(a).offScale, 0);
});

test("normalize: moved to C, off-scale notes snapped and counted", () => {
  const n = normalizeSteps(parseNoteText("D4 E4 F#4 G4 A4:2 F#4 D4:2 A4 G4 F#4 E4 D4:2 G#4").notes);
  assert.equal(n.scale, "major");
  assert.equal(n.key, "D major");
  assert.equal(n.snapped, 1);
  for (const [m] of n.notes) assert.ok(SCALES.major.includes(m % 12), m);
  assert.equal(n.notes[0][0], 60);
});

test("fit: every lesson note is playable on keys, harp and theremin", () => {
  const wide = [[48, 1], [60, 1], [62, 1], [79, 1], [84, 1], [65, 1]];
  for (const avail of [scaleNotes(0, "major", 4, 8), scaleNotes(0, "major", 4, 10), scaleNotes(0, "minor", 3, 15)]) {
    const { notes, folded } = fitToNotes(wide, avail);
    for (const [m] of notes) assert.ok(avail.includes(m), `${m} in ${avail}`);
    assert.ok(folded >= 1);
  }
  // a melody that already fits is left alone
  const twinkle = [[60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2]];
  assert.deepEqual(fitToNotes(twinkle, scaleNotes(0, "major", 4, 8)), { notes: twinkle, folded: 0 });
});

test("custom song: works as a wait-mode lesson end to end", () => {
  const song = makeCustomSong(parseNoteText("E D C D E E E:2 D D D:2 E G G:2 E D C D E E E E D D E D C:4").notes, { title: "my_tune.mid", source: "text", id: "mine-abc" });
  assert.equal(song.title, "my tune");
  assert.equal(song.scale, "major");
  assert.match(song.origin, /Your melody/);
  const keys = scaleNotes(0, song.scale, 4, 8);
  const fitted = { ...song, notes: fitToNotes(song.notes, keys).notes };
  const lesson = new SongLesson(fitted);
  for (const [m] of fitted.notes) lesson.play(m);
  assert.equal(lesson.done, true);
  assert.equal(lesson.stars, 3);
  assert.throws(() => makeCustomSong([[60, 1]], { source: "text" }), /at least/);
  const long = makeCustomSong(Array.from({ length: 300 }, (_, i) => [60 + (i % 5), 1]), { source: "midi" });
  assert.equal(long.notes.length, MELODY_LIMITS.maxNotes);
  assert.equal(long.truncated, true);
});

test("storage: only well-formed songs load back, newest first, capped", () => {
  const good = makeCustomSong(parseNoteText("C D E F G").notes, { source: "text", id: "mine-1" });
  const bad = [{ id: "x", notes: [] }, { ...good, id: "mine-2", notes: [[60, 1], ["<img>", 1], [62, 1]] }, { ...good, id: "mine-3", scale: "lydian" }];
  assert.deepEqual(loadCustomSongs(JSON.stringify([good, ...bad])).map((s) => s.id), ["mine-1"]);
  assert.deepEqual(loadCustomSongs("{oops"), []);
  let list = [];
  for (let i = 0; i < 25; i++) list = addCustomSong(list, { ...good, id: `mine-${i}` });
  assert.equal(list.length, MELODY_LIMITS.maxSongs);
  assert.equal(list[0].id, "mine-24");
  assert.equal(cleanTitle("<b>Song</b>.mp3"), "bSong/b");
});

test("file check: MIDI and audio accepted, the rest refused", () => {
  assert.deepEqual(melodyFileKind({ name: "tune.MID", size: 100 }), { kind: "midi" });
  assert.deepEqual(melodyFileKind({ name: "hum.m4a", type: "audio/mp4", size: 100 }), { kind: "audio" });
  assert.deepEqual(melodyFileKind({ name: "voice", type: "audio/webm", size: 100 }), { kind: "audio" });
  assert.match(melodyFileKind({ name: "a.pdf", size: 100 }).error, /MIDI/);
  assert.match(melodyFileKind({ name: "big.mid", size: 9e6 }).error, /too large/);
  assert.match(melodyFileKind({ name: "e.mid", size: 0 }).error, /empty/);
});
