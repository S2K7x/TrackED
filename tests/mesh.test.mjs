import { test } from "node:test";
import assert from "node:assert/strict";
import { UV, TRIS, CONTOURS } from "../src/face-mesh-data.js";
import { swapAlpha } from "../src/masks.js";
import { frontWinding } from "../src/renderer.js";

test("canonical mesh: 468 UVs in [0,1], 898 triangles over valid landmarks", () => {
  assert.equal(UV.length, 468 * 2);
  assert.ok(UV.every((v) => v >= 0 && v <= 1));
  assert.equal(TRIS.length, 898 * 3);
  assert.ok(TRIS.every((i) => i < 468));
});

test("UV layout is upright: forehead above nose above chin, left eye on the left", () => {
  const v = (i) => UV[i * 2 + 1], u = (i) => UV[i * 2];
  assert.ok(v(10) < v(1) && v(1) < v(152));
  assert.ok(u(33) < 0.5 && u(263) > 0.5);
});

test("contours are closed loops", () => {
  for (const k of ["oval", "lipsOuter", "lipsInner", "eyeL", "eyeR"]) {
    const loop = CONTOURS[k];
    assert.equal(loop[0], loop.at(-1), k);
    assert.ok(loop.length > 8, k);
  }
});

test("swap alpha: 0 on the outline, eyes and inner lips; 1 in the middle of the cheeks", () => {
  const a = swapAlpha();
  for (const i of CONTOURS.oval) assert.equal(a[i], 0);
  for (const i of [...CONTOURS.eyeL, ...CONTOURS.lipsInner]) assert.equal(a[i], 0);
  assert.equal(a[1], 1); // nose tip
});

test("frontWinding flips with a mirrored mesh", () => {
  const m = new Float32Array(468 * 2);
  m.set([0.2, 0.2], 0); m.set([0.8, 0.2], 2); m.set([0.5, 0.8], 4);
  const mirrored = m.map((v, i) => (i % 2 ? v : 1 - v));
  assert.notEqual(frontWinding(m, [0, 1, 2]), frontWinding(mirrored, [0, 1, 2]));
});
