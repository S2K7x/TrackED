import { test } from "node:test";
import assert from "node:assert/strict";
import { Tutorial, pickHint } from "../src/onboarding.js";

const ctx = (o = {}) => ({ hands: 0, frameShownFor: 0, effectChanges: 0, signsFired: 0, ...o });

test("tutorial advances only when the user succeeds, with a short celebration", () => {
  const tut = new Tutorial();
  tut.start();
  assert.equal(tut.step.id, "hands");
  assert.equal(tut.update(ctx({ hands: 1 }), 0).changed, false);       // prompt stays until success
  const r = tut.update(ctx({ hands: 2 }), 1);
  assert.equal(r.celebrating, true);
  assert.equal(tut.step.id, "hands");                                  // still showing ✓ on this step
  assert.equal(tut.update(ctx({ hands: 2 }), 1.5).celebrating, true);
  tut.update(ctx({ hands: 2 }), 2);
  assert.equal(tut.step.id, "frame");
});

test("full run and manual skip", () => {
  const tut = new Tutorial();
  tut.start();
  let t = 0;
  const all = ctx({ hands: 2, frameShownFor: 1, effectChanges: 1, signsFired: 1 });
  for (let i = 0; i < 20 && tut.active; i++) tut.update(all, (t += 1));
  assert.equal(tut.finished, true);
  assert.equal(tut.active, false);
  const t2 = new Tutorial();
  t2.start();
  t2.next(); t2.next(); t2.next(); t2.next();
  assert.equal(t2.finished, true);
});

test("hints: relevant, one at a time, with a cooldown", () => {
  assert.equal(pickHint({ brightness: 0.1, noHandsFor: 10 }), "dark");      // most important first
  assert.equal(pickHint({ brightness: 0.5, noHandsFor: 10 }), "nohands");
  assert.equal(pickHint({ brightness: 0.5, noHandsFor: 1, oneHandFor: 6 }), "onehand");
  assert.equal(pickHint({ brightness: 0.5, noHandsFor: 10 }, { nohands: 90 }, 100), null); // cooldown
  assert.equal(pickHint({ brightness: 0.5 }), null);
});
