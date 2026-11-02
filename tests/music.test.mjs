import { test } from "node:test";
import assert from "node:assert/strict";
import { midiToFreq, noteName, scaleNotes, pitchAt } from "../src/music/theory.js";
import { PinchKeys, StringCrossing, stringPositions, PadHits, drumPads, thereminControl, sortHands, fingertips } from "../src/music/instruments.js";
import { Looper } from "../src/music/looper.js";

test("theory: frequencies, names, scales", () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(60) - 261.63) < 0.01);
  assert.equal(noteName(60), "C4");
  assert.equal(noteName(61), "C#4");
  assert.deepEqual(scaleNotes(0, "pentatonic", 4, 6), [60, 62, 64, 67, 69, 72]);
  assert.deepEqual(scaleNotes(9, "minor", 3, 3), [57, 59, 60]);
});

test("pitchAt: snapped to the scale, continuous when snap = 0", () => {
  const notes = [60, 62, 64, 67, 69];
  assert.deepEqual(pitchAt(0, notes), { midi: 60, index: 0 });
  assert.deepEqual(pitchAt(1, notes), { midi: 69, index: 4 });
  assert.equal(pitchAt(0.3, notes).midi, 62);           // 0.3 × 4 = 1.2 → note 1
  assert.equal(pitchAt(0.3, notes, 0).midi, 62.4);       // glissando between 62 and 64
  assert.equal(pitchAt(-1, notes).midi, 60);             // clamped
});

// a hand with every fingertip far from the thumb, except the listed pinched fingers
function hand(x, pinched = []) {
  const lm = Array.from({ length: 21 }, () => ({ x, y: 0.5 }));
  lm[0] = { x, y: 0.8 };
  lm[9] = { x, y: 0.6 };                          // hand size 0.2
  lm[4] = { x: x - 0.05, y: 0.55 };
  [8, 12, 16, 20].forEach((t, k) => (lm[t] = pinched.includes(t) ? { x: x - 0.04, y: 0.55 } : { x: x + k * 0.03, y: 0.3 }));
  return lm;
}

test("PinchKeys: press, hold, release with hysteresis; side by screen position", () => {
  const k = new PinchKeys();
  assert.deepEqual(k.update([hand(0.7), hand(0.3, [8])]).pressed, [0]);   // left hand index → key 0
  assert.deepEqual(k.update([hand(0.7), hand(0.3, [8])]).pressed, []);    // held: no repeat
  assert.deepEqual(k.update([hand(0.7, [12]), hand(0.3)]), { pressed: [5], released: [0], down: k.down });
  assert.deepEqual(k.update([]).released, [5]);                          // hands gone → release
});

test("StringCrossing: plucks every string crossed, velocity from speed", () => {
  const xs = stringPositions(4, 0, 1);                 // 0.125, 0.375, 0.625, 0.875
  const s = new StringCrossing(xs);
  assert.deepEqual(s.update([{ id: "a", x: 0.1, y: 0.5 }], 1 / 30), []);
  const p = s.update([{ id: "a", x: 0.4, y: 0.5 }], 1 / 30);
  assert.deepEqual(p.map((x) => x.string), [0, 1]);
  assert.ok(p[0].velocity > 0.9);                       // fast swipe
  assert.deepEqual(s.update([{ id: "a", x: 0.41, y: 0.5 }], 1 / 30), []);
});

test("PadHits: needs a downward strike into the pad, re-arms after leaving", () => {
  const pads = drumPads();
  const h = new PadHits(pads);
  const kick = pads.findIndex((p) => p.name === "kick");
  const cx = pads[kick].x + pads[kick].w / 2, top = pads[kick].y;
  h.update([{ id: "t", x: cx, y: top - 0.05 }], 1 / 30);
  assert.deepEqual(h.update([{ id: "t", x: cx, y: top + 0.05 }], 1 / 30).map((x) => x.pad), [kick]);
  assert.deepEqual(h.update([{ id: "t", x: cx, y: top + 0.1 }], 1 / 30), []);           // still inside
  h.update([{ id: "t", x: cx, y: top - 0.05 }], 1 / 30);                                  // leave (upwards)
  assert.deepEqual(h.update([{ id: "t", x: cx, y: top + 0.06 }], 1).length, 0);           // too slow
});

test("thereminControl: right hand pitch, left hand volume", () => {
  const right = hand(0.8), left = hand(0.2);
  right[8] = { x: 0.8, y: 0.08 };   // high
  left[8] = { x: 0.2, y: 0.95 };    // low → silent
  const c = thereminControl([right, left]);
  assert.equal(c.pitch, 1);
  assert.equal(c.volume, 0);
  assert.equal(thereminControl([right]).volume, 0.75);
  assert.equal(thereminControl([]).active, false);
  assert.equal(sortHands([right, left])[0], left);
  assert.equal(fingertips([right, left]).length, 8);
});

test("Looper: records, loops, wraps and survives long gaps", () => {
  const l = new Looper();
  l.record(10);
  l.add("a", 10.2);
  l.add("b", 10.8);
  assert.equal(l.play(11), true);            // 1 s loop
  assert.deepEqual(l.due(11.5), ["a"]);
  assert.deepEqual(l.due(12.3), ["b", "a"]); // wraps into the second pass
  assert.deepEqual(l.due(20), []);           // long gap → jump to the present, no burst
  assert.deepEqual(l.due(20.9), ["a", "b"]); // and keeps looping normally
  assert.ok(l.progress(20.25) > 0.2 && l.progress(20.25) < 0.3);
  const empty = new Looper();
  empty.record(0);
  assert.equal(empty.play(1), false);         // nothing recorded
  assert.equal(empty.state, "idle");
});

test("music tabs: every group exists, defaults are valid options", async () => {
  const { OPTIONS, MUSIC_TABS, DEFAULTS, PANEL_GROUPS } = await import("../src/options.js");
  for (const t of MUSIC_TABS) for (const g of t.groups) assert.ok(OPTIONS[g] || PANEL_GROUPS.includes(g), g);
  for (const k of ["mode", "instrument", "sound", "scale", "root", "octave", "snap", "reverb", "echo", "midi"]) {
    assert.ok(OPTIONS[k].some((o) => o.value === DEFAULTS[k]), k);
  }
  const { SCALES } = await import("../src/music/theory.js");
  for (const o of OPTIONS.scale) assert.ok(SCALES[o.value], o.value);
});

test("recording with sound picks a container that carries audio", async () => {
  const { pickMime } = await import("../src/capture.js");
  assert.match(pickMime((t) => t.includes("opus"), true), /opus/);
  assert.equal(pickMime((t) => t === "video/webm", true), "video/webm");
  assert.doesNotMatch(pickMime(() => true, false), /opus|mp4a/);   // silent clips stay video-only
});
