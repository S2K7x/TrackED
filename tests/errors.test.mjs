import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCameraError, constraintLadder, checkUpload, fitTextureSize, withRetry, isNetworkError, FailureBudget } from "../src/errors.js";

test("camera errors: standard and legacy names", () => {
  assert.equal(describeCameraError({ name: "NotAllowedError" }).relax, false);
  assert.equal(describeCameraError({ name: "PermissionDeniedError" }).title, describeCameraError({ name: "NotAllowedError" }).title);
  assert.equal(describeCameraError({ name: "DevicesNotFoundError" }).title, "No camera found");
  assert.equal(describeCameraError({ name: "TrackStartError" }).relax, true);
  assert.equal(describeCameraError({ name: "OverconstrainedError" }).relax, true);
  assert.equal(describeCameraError({ name: "SecurityError" }).retry, false);
  assert.match(describeCameraError({ name: "NotSupportedError" }).title, /browser/);
  assert.match(describeCameraError(new Error("boom")).hint, /boom/);
});

test("constraint ladder ends with 'any camera'", () => {
  const l = constraintLadder({ facing: "user", width: 1280, height: 720 });
  assert.equal(l.at(-1), true);
  assert.equal(l[0].width.ideal, 1280);
  assert.ok(l.length >= 3);
});

test("upload validation", () => {
  assert.equal(checkUpload({ type: "image/png", size: 1000 }, "image"), null);
  assert.match(checkUpload({ type: "text/plain", size: 10 }, "image"), /image/);
  assert.match(checkUpload({ type: "image/png", size: 0 }, "image"), /empty/);
  assert.match(checkUpload({ type: "image/png", size: 30e6 }, "image"), /too large/);
  assert.equal(checkUpload({ name: "hat.GLB", size: 1000 }, "model"), null);
  assert.match(checkUpload({ name: "hat.obj", size: 1000 }, "model"), /\.glb/);
  assert.match(checkUpload(null, "image"), /No file/);
});

test("fitTextureSize keeps aspect and respects the GPU limit", () => {
  assert.deepEqual(fitTextureSize(8000, 4000, 4096), { width: 4096, height: 2048, scaled: true });
  assert.deepEqual(fitTextureSize(800, 600, 4096), { width: 800, height: 600, scaled: false });
});

test("withRetry: retries with backoff, stops on non-retryable errors", async () => {
  const waits = [];
  let n = 0;
  const v = await withRetry(async () => { if (++n < 3) throw new TypeError("fetch failed"); return "ok"; }, { sleep: async (ms) => waits.push(ms) });
  assert.equal(v, "ok");
  assert.deepEqual(waits, [800, 1600]);
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error("bad model"); }, { retryable: isNetworkError, sleep: async () => {} }));
  assert.equal(calls, 1);
});

test("FailureBudget trips after N consecutive failures and resets on success", () => {
  const b = new FailureBudget(3);
  assert.equal(b.fail(), false);
  assert.equal(b.fail(), false);
  b.ok();
  assert.equal(b.fail(), false);
  assert.equal(b.fail(), false);
  assert.equal(b.fail(), true);
});
