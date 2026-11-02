import { test } from "node:test";
import assert from "node:assert/strict";
import { OneEuro } from "../src/one-euro.js";

test("first sample passes through", () => {
  assert.equal(new OneEuro().filter(5, 0), 5);
});

test("reduces jitter on a static signal", () => {
  const f = new OneEuro({ minCutoff: 1, beta: 0 });
  let maxDev = 0;
  for (let i = 0; i < 300; i++) {
    const noisy = 1 + (i % 2 ? 0.01 : -0.01);
    const y = f.filter(noisy, i / 30);
    if (i > 30) maxDev = Math.max(maxDev, Math.abs(y - 1));
  }
  assert.ok(maxDev < 0.005, `deviation ${maxDev}`);
});

test("beta reduces lag on fast motion", () => {
  const lag = (beta) => {
    const f = new OneEuro({ minCutoff: 1, beta });
    let y = 0;
    for (let i = 0; i <= 30; i++) y = f.filter(i / 30, i / 30); // ramp 1 unit/s
    return 1 - y;
  };
  assert.ok(lag(10) < lag(0) / 2);
});

test("non-increasing timestamps reset instead of dividing by zero", () => {
  const f = new OneEuro();
  f.filter(1, 1);
  assert.equal(f.filter(2, 1), 2);
});

test("predict extrapolates along the filtered velocity, with a clamped lead", async () => {
  const { PointsFilter, extrapolate } = await import("../src/one-euro.js");
  const f = new PointsFilter(1, { minCutoff: 1, beta: 10 });
  for (let i = 0; i <= 30; i++) f.filter([{ x: i / 30, y: 0.5 }], i / 30); // moving right at 1 unit/s
  const now = f.predict(0)[0].x, ahead = f.predict(0.05)[0].x;
  assert.ok(ahead > now, "moves forward");
  assert.ok(ahead - now < 0.06, "≈ velocity × lead");
  assert.equal(extrapolate(0, 1, 5), 0.08);   // lead clamped
  assert.equal(extrapolate(0, 1, -1), 0);
  assert.equal(new PointsFilter(1).predict(0.1), null);
});
