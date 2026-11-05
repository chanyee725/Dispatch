import { test } from "node:test";
import assert from "node:assert/strict";
import { enterStage } from "../tasks.js";

const M = 60_000;

test("enterStage records stage and time only", () => {
  const t = { stage: "plan", createdAt: 0, stageAt: 0, stages: [{ stage: "plan", at: 0 }] };
  enterStage(t, "impl", 5 * M);
  enterStage(t, "test", 20 * M);
  assert.equal(t.stage, "test");
  assert.equal(t.stageAt, 20 * M);
  assert.deepEqual(t.stages, [{ stage: "plan", at: 0 }, { stage: "impl", at: 5 * M }, { stage: "test", at: 20 * M }]);
  assert.deepEqual(Object.keys(t.stages[1]).sort(), ["at", "stage"]);
});

test("enterStage seeds history for tasks saved before it existed", () => {
  const t = { stage: "impl", createdAt: 0, stageAt: 3 * M };
  enterStage(t, "review", 10 * M);
  assert.deepEqual(t.stages, [{ stage: "impl", at: 3 * M }, { stage: "review", at: 10 * M }]);
});

test("history is capped", () => {
  const t = { stage: "plan", stageAt: 0, stages: [] };
  for (let i = 0; i < 100; i++) enterStage(t, i % 2 ? "impl" : "review", i);
  assert.equal(t.stages.length, 40);
});
