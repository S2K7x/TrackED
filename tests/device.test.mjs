import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceProfile } from "../src/device.js";

const mq = (coarse) => (q) => q === "(pointer: coarse)" && coarse;

test("desktop with many cores is high tier", () => {
  const p = deviceProfile({ userAgent: "Mozilla/5.0 (Macintosh)", hardwareConcurrency: 10 }, mq(false));
  assert.equal(p.mobile, false);
  assert.equal(p.tier, "high");
  assert.equal(p.extrasEvery, 1);
});

test("low-end phone gets smaller frames and fewer extra passes", () => {
  const p = deviceProfile({ userAgent: "Mozilla/5.0 (Linux; Android 12) Mobile", hardwareConcurrency: 4, deviceMemory: 2 }, mq(true));
  assert.equal(p.mobile, true);
  assert.equal(p.tier, "low");
  assert.equal(p.detectWidth, 320);
  assert.equal(p.extrasEvery, 3);
  assert.equal(p.cameraHeight, 480);
});

test("recent phone is mid tier", () => {
  const p = deviceProfile({ userAgent: "iPhone", hardwareConcurrency: 6 }, mq(true));
  assert.equal(p.tier, "mid");
  assert.equal(p.cameraHeight, 720);
});

test("works without navigator / matchMedia", () => {
  assert.ok(["high", "mid", "low"].includes(deviceProfile({}, () => false).tier));
});
