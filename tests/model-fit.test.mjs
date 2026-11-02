import { test } from "node:test";
import assert from "node:assert/strict";
import { FIT_FIELDS, DEFAULT_FIT, clampFit, isDefaultFit, modelKey, FitStore } from "../src/model-fit.js";

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m };
};

test("clampFit fills defaults, clamps and snaps", () => {
  assert.deepEqual(clampFit(undefined), DEFAULT_FIT);
  const f = clampFit({ x: 99, y: "-3.04", rx: -500, scale: 0.1, z: NaN, junk: 5 });
  assert.equal(f.x, 10);
  assert.equal(f.y, -3);
  assert.equal(f.rx, -180);
  assert.equal(f.scale, 0.5);
  assert.equal(f.z, 0);
  assert.equal("junk" in f, false);
  for (const d of FIT_FIELDS) assert.ok(d.min < DEFAULT_FIT[d.key] + 1e-9 && DEFAULT_FIT[d.key] <= d.max, d.key);
});

test("isDefaultFit", () => {
  assert.ok(isDefaultFit(clampFit({})));
  assert.ok(!isDefaultFit(clampFit({ ry: 10 })));
});

test("modelKey depends on content and size, and is stable", () => {
  const a = new Uint8Array(1000).fill(7);
  const b = a.slice(); b[500] = 8;
  assert.equal(modelKey(a.buffer), modelKey(a.slice().buffer));
  assert.notEqual(modelKey(a.buffer), modelKey(b.buffer));
  assert.notEqual(modelKey(a.buffer), modelKey(new Uint8Array(1001).fill(7).buffer));
  // large files: only the head and tail are hashed, the size still counts
  const big = new Uint8Array(600 * 1024);
  const big2 = big.slice(); big2[big2.length - 1] = 1;
  assert.notEqual(modelKey(big.buffer), modelKey(big2.buffer));
});

test("FitStore saves per model, drops defaults, keeps the 20 most recent", () => {
  const s = memory();
  const store = new FitStore(s);
  store.set("a", { y: 2, ry: 15 });
  assert.equal(store.get("a").y, 2);
  assert.deepEqual(store.get("missing"), DEFAULT_FIT);
  store.set("a", DEFAULT_FIT);
  assert.equal(JSON.parse(s.getItem("tracked.modelFits")).length, 0);
  for (let i = 0; i < 25; i++) store.set(`m${i}`, { x: 1 });
  const list = JSON.parse(s.getItem("tracked.modelFits"));
  assert.equal(list.length, 20);
  assert.equal(list[0].key, "m24");
  assert.deepEqual(store.get("m0"), DEFAULT_FIT);
});

test("FitStore survives broken or blocked storage", () => {
  const s = memory();
  s.setItem("tracked.modelFits", "{not json");
  assert.deepEqual(new FitStore(s).get("a"), DEFAULT_FIT);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const store = new FitStore(blocked);
  store.set("a", { x: 1 });
  assert.deepEqual(store.get("a"), DEFAULT_FIT);
  assert.deepEqual(new FitStore(null).get("a"), DEFAULT_FIT);
});
