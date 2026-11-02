import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeFace, mirrorFace, selectFaces, TARGETS, SEG, FACE } from "../src/faces.js";

function mesh() {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  lm[FACE.IRIS_A] = { x: 0.45, y: 0.4 };
  lm[FACE.IRIS_B] = { x: 0.55, y: 0.4 };
  lm[FACE.CHEEK_RIGHT] = { x: 0.4, y: 0.5 };
  lm[FACE.CHEEK_LEFT] = { x: 0.6, y: 0.5 };
  lm[FACE.UPPER_LIP] = { x: 0.5, y: 0.58 };
  lm[FACE.LOWER_LIP] = { x: 0.5, y: 0.62 };
  lm[FACE.NOSE_TIP] = { x: 0.5, y: 0.5 };
  return lm;
}

test("summarizeFace extracts anchors and aspect-corrected radius", () => {
  const f = summarizeFace(mesh(), 16 / 9);
  assert.deepEqual(f.eyeL, { x: 0.45, y: 0.4 });
  assert.deepEqual(f.mouth, { x: 0.5, y: 0.6 });
  assert.ok(Math.abs(f.r - 0.1 * 16 / 9) < 1e-9);
});

test("summarizeFace falls back to eye corners without iris points", () => {
  const lm = mesh().slice(0, 468);
  for (const i of [...FACE.EYE_A, ...FACE.EYE_B]) lm[i] = { x: i < 200 ? 0.44 : 0.56, y: 0.4 };
  const f = summarizeFace(lm);
  assert.equal(f.eyeL.x, 0.44);
  assert.equal(f.eyeR.x, 0.56);
});

test("mirrorFace keeps eyeL on the left", () => {
  const m = mirrorFace({ eyeL: { x: 0.2, y: 0 }, eyeR: { x: 0.3, y: 0 }, mouth: { x: 0.25, y: 0 }, nose: { x: 0.25, y: 0 }, r: 1 });
  assert.ok(m.eyeL.x < m.eyeR.x);
  assert.equal(m.eyeL.x, 0.7);
});

test("selectFaces: me = biggest face, others = the rest", () => {
  const faces = [{ r: 0.05 }, { r: 0.2 }, { r: 0.1 }];
  assert.deepEqual(selectFaces(faces, "all"), [true, true, true]);
  assert.deepEqual(selectFaces(faces, "me"), [false, true, false]);
  assert.deepEqual(selectFaces(faces, "others"), [true, false, true]);
  assert.deepEqual(selectFaces([], "me"), []);
});

test("segmentation targets", () => {
  assert.equal(TARGETS.all, null);
  assert.equal(TARGETS.background, 1);
  assert.equal(TARGETS.people & (1 << SEG.BACKGROUND), 0);
  assert.equal(TARGETS.people | TARGETS.background, 0b111111);
});
