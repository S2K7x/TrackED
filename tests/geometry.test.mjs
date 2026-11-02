import { test } from "node:test";
import assert from "node:assert/strict";
import { quadFromHands, segmentsIntersect, quadArea, LM } from "../src/geometry.js";

function hand({ index, thumb }) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  lm[LM.INDEX_TIP] = index;
  lm[LM.THUMB_TIP] = thumb;
  return lm;
}

const left = hand({ index: { x: 0.2, y: 0.3 }, thumb: { x: 0.25, y: 0.6 } });
const right = hand({ index: { x: 0.8, y: 0.3 }, thumb: { x: 0.75, y: 0.6 } });

test("quad is ordered and not self-intersecting, regardless of hand order", () => {
  for (const q of [quadFromHands(left, right), quadFromHands(right, left)]) {
    assert.deepEqual(q[0], { x: 0.2, y: 0.3 });
    assert.deepEqual(q[1], { x: 0.8, y: 0.3 });
    assert.ok(segmentsIntersect(q[0], q[2], q[1], q[3]));
  }
});

test("twisted configuration is untwisted", () => {
  // right hand upside down: thumb above index
  const r = hand({ index: { x: 0.8, y: 0.6 }, thumb: { x: 0.75, y: 0.3 } });
  const q = quadFromHands(left, r);
  assert.ok(segmentsIntersect(q[0], q[2], q[1], q[3]));
});

test("quadArea", () => {
  const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  assert.equal(quadArea(sq), 1);
  assert.equal(quadArea(sq, 2), 2);
});

test("pointInQuad / faceInFrame", async () => {
  const { pointInQuad, faceInFrame } = await import("../src/geometry.js");
  const q = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.25 }, { x: 0.75, y: 0.7 }, { x: 0.25, y: 0.65 }];
  assert.ok(pointInQuad({ x: 0.5, y: 0.45 }, q));
  assert.ok(!pointInQuad({ x: 0.1, y: 0.45 }, q));
  const face = { eyeL: { x: 0.45, y: 0.4 }, eyeR: { x: 0.55, y: 0.4 }, nose: { x: 0.5, y: 0.5 } };
  assert.ok(faceInFrame(face, q));
  assert.ok(!faceInFrame({ eyeL: { x: 0.05, y: 0.4 }, eyeR: { x: 0.15, y: 0.4 }, nose: { x: 0.5, y: 0.5 } }, q));
  assert.ok(!faceInFrame(face, null));
});
