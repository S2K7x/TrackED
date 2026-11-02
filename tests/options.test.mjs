import { test } from "node:test";
import assert from "node:assert/strict";
import { OPTIONS, TABS, DEFAULTS, PANEL_GROUPS, EXCLUSIVE, exclusiveConflicts, hexToRgb } from "../src/options.js";
import { EFFECTS, FACE_FX, SHAPES, BORDERS } from "../src/renderer.js";
import { TARGETS } from "../src/faces.js";
import { pickMime } from "../src/capture.js";

test("every UI option exists in the renderer / mask tables", () => {
  const sets = { effect: EFFECTS, face: FACE_FX, shape: SHAPES, border: BORDERS, target: Object.keys(TARGETS) };
  for (const [k, list] of Object.entries(sets)) {
    for (const o of OPTIONS[k]) assert.ok(list.includes(o.value), `${k}: ${o.value}`);
  }
});

test("defaults are valid options and every tab group exists", () => {
  for (const [k, v] of Object.entries(DEFAULTS)) assert.ok(OPTIONS[k].some((o) => o.value === v), k);
  for (const t of TABS) for (const g of t.groups) assert.ok(OPTIONS[g] || PANEL_GROUPS.includes(g), g);
});

test("ready-made 3D models exist and aren't built-in primitive accessories", async () => {
  const { existsSync } = await import("node:fs");
  const { ACCESSORIES } = await import("../src/accessories.js");
  const models = OPTIONS.accessory.filter((o) => o.glb);
  assert.ok(models.length > 0);
  for (const o of models) {
    assert.ok(existsSync(new URL(`../${o.glb}`, import.meta.url)), o.glb);
    assert.ok(!ACCESSORIES.includes(o.value), o.value);
  }
});

test("every built-in mask option has a painter", async () => {
  const { MASKS } = await import("../src/masks.js");
  for (const o of OPTIONS.mask) if (o.value !== "none" && !o.upload) assert.ok(MASKS.includes(o.value), o.value);
});

test("Kitsune and the Aero helmet are never worn together", () => {
  for (const pair of EXCLUSIVE) for (const [k, v] of pair) assert.ok(OPTIONS[k].some((o) => o.value === v), `${k}: ${v}`);
  assert.deepEqual(exclusiveConflicts({ mask: "none", accessory: "aero" }, "mask", "kitsune"),
    [{ key: "accessory", value: "none", label: "Aero helmet" }]);
  assert.deepEqual(exclusiveConflicts({ mask: "kitsune", accessory: "none" }, "accessory", "aero"),
    [{ key: "mask", value: "none", label: "Kitsune" }]);
  assert.deepEqual(exclusiveConflicts({ mask: "skull", accessory: "aero" }, "mask", "kitsune").length, 1);
  assert.deepEqual(exclusiveConflicts({ mask: "kitsune", accessory: "crown" }, "accessory", "halo"), []);
  assert.deepEqual(exclusiveConflicts({ mask: "none", accessory: "aero" }, "mask", "gold"), []);
});

test("hexToRgb", () => {
  assert.deepEqual(hexToRgb("#ff0080"), [1, 0, 128 / 255]);
});

test("pickMime prefers mp4, falls back to webm, then empty", () => {
  assert.match(pickMime((t) => true), /mp4/);
  assert.equal(pickMime((t) => t === "video/webm"), "video/webm");
  assert.equal(pickMime(() => false), "");
});
