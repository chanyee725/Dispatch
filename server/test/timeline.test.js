import { test } from "node:test";
import assert from "node:assert/strict";
import { recordState, trimToWindow, windowSpans } from "../../shared/timeline.js";

const H = 3600_000;

test("recordState: appends only on a change of state", () => {
  const h = [];
  recordState(h, "working", 1);
  recordState(h, "working", 2);
  recordState(h, "waiting", 3);
  assert.deepEqual(h, [[1, "working"], [3, "waiting"]]);
});

test("recordState: caps the history, oldest dropped first", () => {
  const h = [];
  for (let i = 0; i < 250; i++) recordState(h, i % 2 ? "working" : "resting", i);
  assert.equal(h.length, 200);
  assert.deepEqual(h[0], [50, "resting"]);
  assert.deepEqual(h.at(-1), [249, "working"]);
  recordState(h, "done", 300, 3);
  assert.deepEqual(h, [[248, "resting"], [249, "working"], [300, "done"]]);
});

test("recordState: a clock stepping back keeps the order", () => {
  const h = recordState([[100, "working"]], "resting", 90);
  assert.deepEqual(h, [[100, "working"], [100, "resting"]]);
});

test("trimToWindow: keeps the state the window opens with", () => {
  const now = 10 * H;
  const h = [[1 * H, "working"], [5 * H, "resting"], [9 * H, "working"], [9.5 * H, "waiting"]];
  assert.deepEqual(trimToWindow(h, now, 2 * H), [[5 * H, "resting"], [9 * H, "working"], [9.5 * H, "waiting"]]);
  assert.deepEqual(trimToWindow([[9 * H, "working"]], now, 2 * H), [[9 * H, "working"]]);
  assert.deepEqual(trimToWindow([], now, 2 * H), []);
});

test("windowSpans: clips to the window and runs the last state to now", () => {
  const now = 10 * H;
  const h = [[5 * H, "resting"], [9 * H, "working"], [9.5 * H, "waiting"]];
  assert.deepEqual(windowSpans(h, now, 2 * H).spans, [
    { state: "resting", from: 8 * H, to: 9 * H },
    { state: "working", from: 9 * H, to: 9.5 * H },
    { state: "waiting", from: 9.5 * H, to: 10 * H },
  ]);
});

test("windowSpans: a session started inside the window leaves the left empty", () => {
  const now = 10 * H;
  const { spans } = windowSpans([[9.75 * H, "working"]], now, 2 * H);
  assert.deepEqual(spans, [{ state: "working", from: 9.75 * H, to: 10 * H }]);
});

test("windowSpans: failures inside the window become ticks", () => {
  const now = 10 * H;
  const h = [[7 * H, "failed"], [8.5 * H, "working"], [9 * H, "failed"], [9.2 * H, "working"]];
  const { spans, fails } = windowSpans(h, now, 2 * H);
  assert.deepEqual(fails, [9 * H]);
  assert.equal(spans[0].state, "failed");
  assert.equal(spans[0].from, 8 * H);
});

test("windowSpans: zero-length and out-of-window entries are dropped", () => {
  const now = 10 * H;
  const h = [[9 * H, "working"], [9 * H, "resting"], [11 * H, "done"]];
  assert.deepEqual(windowSpans(h, now, 2 * H).spans, [{ state: "resting", from: 9 * H, to: 10 * H }]);
});
