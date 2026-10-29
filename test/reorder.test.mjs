import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { moveWithin } from "../dist/tui.js";

test("moveWithin places a section before or after its target", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(moveWithin(ids, "a", "c", true), ["b", "c", "a", "d"]);
  assert.deepEqual(moveWithin(ids, "d", "b", false), ["a", "d", "b", "c"]);
  assert.deepEqual(moveWithin(ids, "b", "d", true), ["a", "c", "d", "b"]);
});

test("moveWithin returns undefined when nothing would change", () => {
  assert.equal(moveWithin(["a", "b", "c"], "a", "b", false), undefined);
  assert.equal(moveWithin(["a", "b", "c"], "b", "a", true), undefined);
  assert.equal(moveWithin(["a", "b", "c"], "a", "a", true), undefined);
  assert.equal(moveWithin(["a", "b", "c"], "x", "a", true), undefined);
  assert.equal(moveWithin(["a", "b", "c"], "a", "x", true), undefined);
});

test("keep-open reordering and ctrl-gated drag are wired in", async () => {
  const source = await readFile("src/tui.tsx", "utf8");
  // Move up/down are dialog footer actions, which the host triggers without
  // closing the dialog, so a section can be nudged repeatedly.
  assert.match(source, /bind:\s*"alt\+up"/);
  assert.match(source, /bind:\s*"alt\+down"/);
  // Ctrl is the only modifier the renderer excludes from its text-selection
  // path, so ctrl + drag reorders rather than selecting the section content.
  assert.match(source, /modifiers\?\.ctrl/);
  // Drag reordering can be disabled from the layout config.
  assert.match(source, /dragReorder\s*!==\s*false/);
});
