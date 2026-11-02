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
