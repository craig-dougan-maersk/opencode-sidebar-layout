import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dragReduce, moveWithin } from "../dist/tui.js";

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

test("dragReduce commits the move on the release the renderer sends first", () => {
  // The renderer dispatches drag-end and up to the source, then drop to the
  // target. Committing on `up` works even when the drop never arrives, and a
  // later drop must not apply the same move twice.
  let state = dragReduce(
    {},
    { type: "down", id: "a", button: 0, ctrl: true },
  ).state;
  assert.deepEqual(state, { source: "a" });
  state = dragReduce(state, {
    type: "over",
    id: "c",
    pointerY: 10,
    top: 0,
    height: 4,
  }).state;
  assert.deepEqual(state, { source: "a", target: { id: "c", after: true } });
  state = dragReduce(state, { type: "drag-end", id: "a" }).state;
  const release = dragReduce(state, { type: "up", id: "a" });
  assert.deepEqual(release.move, { id: "a", targetId: "c", after: true });
  assert.equal(
    dragReduce(release.state, { type: "drop", id: "c" }).move,
    undefined,
  );
});

test("dragReduce ignores a release without a distinct target", () => {
  const armed = { source: "a" };
  assert.equal(dragReduce(armed, { type: "up", id: "a" }).move, undefined);
  assert.equal(dragReduce(armed, { type: "drop", id: "a" }).move, undefined);
  assert.equal(dragReduce({}, { type: "up", id: "a" }).move, undefined);
});

test("dragReduce clears the target when the pointer returns to the source", () => {
  const state = dragReduce(
    { source: "a", target: { id: "c", after: true } },
    { type: "over", id: "a", pointerY: 5, top: 0, height: 4 },
  ).state;
  assert.deepEqual(state, { source: "a" });
  assert.equal(dragReduce(state, { type: "up", id: "a" }).move, undefined);
});

test("dragReduce arms on ctrl or non-selectable content only", () => {
  assert.deepEqual(
    dragReduce({}, { type: "down", id: "a", button: 0, ctrl: true }).state,
    { source: "a" },
  );
  assert.deepEqual(
    dragReduce({}, { type: "down", id: "a", button: 0, plain: true }).state,
    { source: "a" },
  );
  assert.deepEqual(
    dragReduce({}, { type: "down", id: "a", button: 0 }).state,
    {},
  );
  assert.deepEqual(
    dragReduce({ source: "x" }, { type: "down", id: "a", button: 0 }).state,
    {},
  );
  assert.deepEqual(
    dragReduce({}, { type: "down", id: "a", button: 2, ctrl: true }).state,
    {},
  );
});

test("dragReduce picks before or after by the target midpoint", () => {
  const armed = { source: "a" };
  assert.deepEqual(
    dragReduce(armed, { type: "over", id: "b", pointerY: 1, top: 0, height: 4 })
      .state.target,
    { id: "b", after: false },
  );
  assert.deepEqual(
    dragReduce(armed, { type: "over", id: "b", pointerY: 3, top: 0, height: 4 })
      .state.target,
    { id: "b", after: true },
  );
  assert.deepEqual(
    dragReduce(armed, {
      type: "over",
      id: "a",
      pointerY: 99,
      top: 0,
      height: 4,
    }).state,
    armed,
  );
});

test("dragReduce produces no move without a distinct target", () => {
  assert.equal(
    dragReduce({ source: "a" }, { type: "drop", id: "a" }).move,
    undefined,
  );
  assert.equal(
    dragReduce({ source: "a" }, { type: "drop", id: "b" }).move,
    undefined,
  );
  assert.equal(
    dragReduce(
      { source: "a", target: { id: "a", after: true } },
      { type: "drop", id: "a" },
    ).move,
    undefined,
  );
  assert.equal(dragReduce({}, { type: "drop", id: "b" }).move, undefined);
});

test("keep-open reordering and the drag handle are wired in", async () => {
  const source = await readFile("src/tui.tsx", "utf8");
  // Move up/down are dialog footer actions, which the host triggers without
  // closing the dialog, so a section can be nudged repeatedly.
  assert.match(source, /bind:\s*"alt\+up"/);
  assert.match(source, /bind:\s*"alt\+down"/);
  // Ctrl is the only modifier the renderer excludes from its text-selection
  // path, so ctrl + drag reorders rather than selecting the section content.
  assert.match(source, /modifiers\?\.ctrl/);
  // The heading is a non-selectable drag handle: a plain press there arms a
  // reorder, and a release in place still toggles collapse.
  assert.match(source, /selectable=\{false\}/);
  assert.match(source, /onMouseUp=/);
  // Drag reordering can be disabled from the layout config.
  assert.match(source, /dragReorder\s*!==\s*false/);
});
