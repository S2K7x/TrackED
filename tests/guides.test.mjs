import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIDES, GUIDE_CHIP } from "../src/guides.js";
import { OPTIONS, TABS } from "../src/options.js";

const texts = (g) => [g.title, g.intro, g.link, ...g.sections.flatMap((s) => [s.heading, ...(s.steps || []), ...(s.tips || [])])];

test("every customisable tab has a guide, and every guide belongs to a tab", () => {
  for (const t of TABS) {
    // uploads listed in OPTIONS, plus the effect tab's "Your image" (drawn in main.js) and the custom colour picker
    const customisable = t.groups.some((g) => OPTIONS[g]?.some((o) => o.upload) || g === "effect" || g === "color");
    assert.equal(!!GUIDES[t.id], customisable, t.id);
  }
  for (const id of Object.keys(GUIDES)) {
    assert.ok(TABS.some((t) => t.id === id), id);
    assert.ok(GUIDE_CHIP[id], id);
  }
});

test("guides are complete and only use safe inline markup", () => {
  for (const [id, g] of Object.entries(GUIDES)) {
    assert.ok(g.sections.length, id);
    for (const s of g.sections) assert.ok(s.heading && (s.steps?.length || s.tips?.length), `${id}: ${s.heading}`);
    for (const t of texts(g)) {
      assert.equal(typeof t, "string", id);
      assert.ok(t.trim().length > 2, id);
      for (const tag of t.match(/<\/?([a-z0-9]+)/gi) || []) assert.match(tag, /^<\/?(b|em|kbd)$/i, `${id}: ${tag}`);
    }
  }
});

test("guides mention the real upload limits and labels", () => {
  const all = Object.values(GUIDES).flatMap(texts).join(" ");
  for (const label of ["Your image", "Your mask", "Face swap", "Your 3D model", "As modelled (Blender head)", "Download mask template", "Download Blender head", "Custom"]) {
    assert.ok(all.includes(label), label);
  }
  assert.ok(OPTIONS.anchor.some((o) => o.label === "As modelled (Blender head)"));
  assert.match(all, /25 MB/);
  assert.match(all, /60 MB/);
});
