import { test } from "node:test";
import assert from "node:assert/strict";
import { MaskStabilizer } from "../src/temporal.js";

const m = (...v) => Uint8Array.from(v);

test("suppresses a one-frame flip", () => {
  const s = new MaskStabilizer();
  s.apply(m(0, 3));
  s.apply(m(0, 3));
  assert.deepEqual([...s.apply(m(3, 3))], [0, 3]);   // pixel 0 flips for one frame → kept
  assert.deepEqual([...s.apply(m(0, 3))], [0, 3]);
});

test("a real change goes through on its second frame and never locks", () => {
  const s = new MaskStabilizer();
  s.apply(m(0)); s.apply(m(0));
  assert.deepEqual([...s.apply(m(4))], [0]);          // first frame of the change: held
  assert.deepEqual([...s.apply(m(4))], [4]);          // second frame: accepted
  assert.deepEqual([...s.apply(m(4))], [4]);
});

test("first frames and size changes pass through", () => {
  const s = new MaskStabilizer();
  assert.deepEqual([...s.apply(m(1, 2))], [1, 2]);
  assert.deepEqual([...s.apply(m(5, 5, 5))], [5, 5, 5]);
});
