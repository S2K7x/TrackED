import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySign, SignHold } from "../src/gestures.js";

// Synthetic hands: wrist at the bottom, fingers pointing up (y decreases upwards).
// Each finger is a list of 4 joints (mcp, pip, dip, tip).
function hand({ thumb, index, middle, ring, pinky }) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
  lm[0] = { x: 0.5, y: 0.8 };
  const straight = (x0) => [0.62, 0.55, 0.5, 0.45].map((y) => ({ x: x0, y }));
  const curled = (x0) => [{ x: x0, y: 0.62 }, { x: x0, y: 0.56 }, { x: x0 + 0.01, y: 0.6 }, { x: x0 + 0.01, y: 0.65 }];
  const put = (start, joints) => joints.forEach((p, k) => (lm[start + k] = p));
  put(5, index === "spread" ? [{ x: 0.46, y: 0.62 }, { x: 0.43, y: 0.55 }, { x: 0.41, y: 0.5 }, { x: 0.39, y: 0.45 }] : index ? straight(0.46) : curled(0.46));
  put(9, middle === "spread" ? [{ x: 0.5, y: 0.62 }, { x: 0.53, y: 0.55 }, { x: 0.55, y: 0.5 }, { x: 0.57, y: 0.45 }] : middle ? straight(0.5) : curled(0.5));
  put(13, ring ? straight(0.54) : curled(0.54));
  put(17, pinky ? straight(0.58) : curled(0.58));
  // thumb: "up" = straight along the side pointing up, "side" = straight sideways, otherwise tucked
  if (thumb === "up") [[0.4, 0.74], [0.38, 0.66], [0.37, 0.58], [0.36, 0.5]].forEach(([x, y], k) => (lm[1 + k] = { x, y }));
  else if (thumb === "side") [[0.44, 0.76], [0.38, 0.73], [0.32, 0.7], [0.26, 0.67]].forEach(([x, y], k) => (lm[1 + k] = { x, y }));
  else [[0.45, 0.76], [0.44, 0.7], [0.47, 0.67], [0.5, 0.66]].forEach(([x, y], k) => (lm[1 + k] = { x, y }));
  return lm;
}

test("open palm", () => {
  assert.equal(classifySign(hand({ thumb: "side", index: 1, middle: 1, ring: 1, pinky: 1 })), "open_palm");
});

test("victory needs two spread fingers", () => {
  assert.equal(classifySign(hand({ index: "spread", middle: "spread" })), "victory");
});

test("thumbs up", () => {
  assert.equal(classifySign(hand({ thumb: "up" })), "thumbs_up");
});

test("a fist or the L of the frame gesture is not a sign", () => {
  assert.equal(classifySign(hand({})), null);
  assert.equal(classifySign(hand({ thumb: "side", index: 1 })), null);
});

test("SignHold fires once after the hold time", () => {
  const h = new SignHold(0.5);
  assert.equal(h.update("victory", 0).fire, false);
  assert.ok(Math.abs(h.update("victory", 0.25).progress - 0.5) < 1e-9);
  assert.equal(h.update("victory", 0.5).fire, true);
  assert.equal(h.update("victory", 0.9).fire, false);   // held: no repeat
  h.update(null, 1);
  h.update("victory", 1.1);
  assert.equal(h.update("victory", 1.6).fire, true);    // released and shown again
});

test("3D world landmarks: a palm seen edge-on in the image is still an open palm", async () => {
  // image: fingers foreshortened (all tips crowded near the knuckles) → 2D alone can't tell
  const img = Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + (i % 4) * 0.002, y: 0.6 - (i % 4) * 0.002 }));
  // world (metres): a flat, open hand pointing at the camera along -z
  const world = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const finger = (start, x) => [0.03, 0.06, 0.08, 0.1].forEach((d, k) => (world[start + k] = { x, y: 0.02, z: -d }));
  finger(5, -0.02); finger(9, -0.005); finger(13, 0.01); finger(17, 0.025);
  [[-0.02, 0.0, -0.01], [-0.04, 0.005, -0.02], [-0.06, 0.01, -0.03], [-0.08, 0.015, -0.04]].forEach(([x, y, z], k) => (world[1 + k] = { x, y, z }));
  world[0] = { x: 0, y: 0.03, z: 0.02 };
  assert.equal(classifySign(img, 1), null);
  assert.equal(classifySign(img, 1, world), "open_palm");
});
