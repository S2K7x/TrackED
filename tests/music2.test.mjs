import { test } from "node:test";
import assert from "node:assert/strict";
import { chordOn, PROGRESSIONS, parentScale } from "../src/music/theory.js";
import { SONGS } from "../src/music/songs.js";
import { StepClock } from "../src/music/scheduler.js";
import { STYLES, bandStep, chordForBar, metronomeStep } from "../src/music/band.js";
import { SongLesson, RhythmLesson, judge, SkillLesson, SKILLS } from "../src/music/lessons.js";
import { MUSIC_GUIDES, MUSIC_GUIDE_ORDER } from "../src/music/learn.js";
import { StrumLine, StepGrid } from "../src/music/instruments.js";
import { scaleNotes } from "../src/music/theory.js";

test("chords: diatonic triads with the right quality", () => {
  assert.deepEqual(chordOn(0, "major", 0, 3), { notes: [48, 52, 55], root: 48, name: "C" });
  assert.equal(chordOn(0, "major", 5, 3).name, "Am");
  assert.equal(chordOn(0, "major", 6, 3).name, "Bdim");
  assert.equal(chordOn(0, "pentatonic", 4, 3).name, "G");          // parent scale used
  assert.equal(parentScale("blues"), "minor");
  assert.equal(chordOn(0, "major", 0, 3, true).notes.length, 4);
  for (const p of Object.values(PROGRESSIONS)) assert.ok(p.degrees.every((d) => d >= 0 && d < 7));
});

test("songs fit the 8 pinch keys (C major, middle range)", () => {
  const keys = new Set(scaleNotes(0, "major", 4, 8));
  for (const s of SONGS) {
    assert.ok(s.origin && s.title && s.notes.length >= 8, s.id);
    for (const [m, beats] of s.notes) { assert.ok(keys.has(m), `${s.id}: ${m}`); assert.ok(beats > 0); }
  }
});

test("StepClock: look-ahead scheduling, tempo, no burst after a freeze", () => {
  const c = new StepClock({ bpm: 120 });          // 16th = 0.125 s
  c.start(10, 0);
  assert.deepEqual(c.collect(10, 0.2).map((s) => s.step), [0, 1]);
  assert.deepEqual(c.collect(10.1, 0.2).map((s) => s.step), [2]);
  const frozen = c.collect(20, 0.2);              // 10 s later: resync, not 80 steps at once
  assert.ok(frozen.length <= 3, String(frozen.length));
  assert.ok(frozen[0].time >= 20 - 0.13);
  c.setBpm(1000);
  assert.equal(c.bpm, 220);
});

test("band: grooves in key, crash on the first bar, metronome accents", () => {
  const o = { style: "pop", root: 0, scale: "major", progression: "pop" };
  const s0 = bandStep(0, o);
  assert.ok(s0.some((e) => e.name === "kick"));
  assert.ok(s0.some((e) => e.timbre === "bass" && e.midi === 36));   // C2 root
  assert.ok(s0.some((e) => e.name === "crash"));
  assert.equal(chordForBar(1, o).name, "G");                          // I–V–vi–IV
  assert.equal(chordForBar(2, o).name, "Am");
  assert.deepEqual(bandStep(0, { ...o, style: "off" }), []);
  for (const st of Object.values(STYLES)) for (const k of ["kick", "snare", "hat", "bass", "stab"]) assert.equal(st[k].length, 16);
  assert.deepEqual(metronomeStep(0), { accent: true });
  assert.deepEqual(metronomeStep(4), { accent: false });
  assert.equal(metronomeStep(2), null);
});

test("SongLesson: wait mode, mistakes and stars", () => {
  const l = new SongLesson({ title: "t", notes: [[60, 1], [62, 1], [64, 1]] });
  assert.equal(l.target, 60);
  assert.equal(l.play(61), "wrong");
  assert.equal(l.play(60), "correct");
  assert.deepEqual(l.upcoming(), [62, 64]);
  l.play(62);
  assert.equal(l.play(64), "done");
  assert.equal(l.stars, 2);                       // 1 mistake on 3 notes
  assert.equal(l.play(60), "ignored");
});

test("RhythmLesson: timing windows, misses swept, accuracy", () => {
  assert.equal(judge(0.05), "perfect");
  assert.equal(judge(-0.1), "good");
  assert.equal(judge(0.3), "miss");
  const r = new RhythmLesson({ bpm: 60, bars: 1, pattern: { kick: [0, 8], snare: [4] } }, 100); // 16th = 0.25 s
  assert.equal(r.hit("kick", 100.02), "perfect");
  assert.equal(r.hit("snare", 101.1), "good");    // expected at 101
  assert.equal(r.hit("snare", 103), "extra");
  r.sweep(103);                                   // kick at 102 missed
  assert.equal(r.score.miss, 1);
  assert.ok(r.accuracy > 0.5 && r.accuracy < 0.6);
});

test("SkillLesson: steps advance on real actions", () => {
  for (const k of Object.keys(SKILLS)) assert.ok(SKILLS[k].length >= 3, k);
  const s = new SkillLesson("keys");
  assert.equal(s.record({ note: 60 }), true);     // step 1: any note
  for (const n of [60, 62, 64]) assert.equal(s.record({ note: n }), false);
  assert.equal(s.record({ note: 67 }), true);     // step 2: 4 different notes
  const d = new SkillLesson("dj");
  d.record({ filter: 0.1 });
  assert.equal(d.record({ filter: 0.8 }), true);
});

test("StrumLine and StepGrid", () => {
  const s = new StrumLine(0.5);
  s.update({ x: 0.7, y: 0.4 }, 1 / 30);
  assert.equal(s.update({ x: 0.7, y: 0.6 }, 1 / 30).dir, "down");
  assert.equal(s.update({ x: 0.7, y: 0.45 }, 1 / 30).dir, "up");
  assert.equal(s.update({ x: 0.7, y: 0.4 }, 1 / 30), null);
  const g = new StepGrid();
  const cell = { x: g.area.x + 0.01, y: g.area.y + 0.01 };   // row 0 (kick), col 0
  assert.equal(g.toggleAt(cell), true);
  assert.deepEqual(g.column(0), ["kick"]);
  assert.deepEqual(g.column(8), ["kick"]);                    // wraps
  assert.equal(g.toggleAt(cell), false);
  assert.equal(g.toggleAt({ x: 0.01, y: 0.01 }), null);
});

test("music guides: complete, safe markup", () => {
  for (const id of MUSIC_GUIDE_ORDER) {
    const g = MUSIC_GUIDES[id];
    assert.ok(g.title && g.intro && g.sections.length, id);
    const texts = [g.title, g.intro, ...g.sections.flatMap((s) => [s.heading, ...(s.steps || []), ...(s.tips || [])])];
    for (const t of texts) for (const tag of t.match(/<\/?([a-z0-9]+)/gi) || []) assert.match(tag, /^<\/?(b|em|kbd)$/i, `${id}: ${tag}`);
  }
});
