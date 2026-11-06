import { test } from "node:test";
import assert from "node:assert/strict";
import { stepStates } from "../src/lib/steps.ts";

const at = (stage: string) => ({ stage, at: 0 }) as never;

test("finished earlier stages are full, the current one is current, later ones todo", () => {
  assert.deepEqual(stepStates({ stage: "review", stages: [at("plan"), at("impl"), at("review")] }), ["done", "done", "current", "todo", "todo"]);
});

test("a stage the task jumped past is skipped", () => {
  assert.deepEqual(stepStates({ stage: "merge", stages: [at("plan"), at("impl"), at("review"), at("merge")] }), ["done", "done", "done", "skipped", "current"]);
});

test("blocked keeps the stage it was in", () => {
  assert.deepEqual(stepStates({ stage: "blocked", stages: [at("plan"), at("impl"), at("blocked")] }), ["done", "blocked", "todo", "todo", "todo"]);
});

test("done task: visited stages done, others skipped", () => {
  assert.deepEqual(stepStates({ stage: "done", stages: [at("plan"), at("impl"), at("merge"), at("done")] }), ["done", "done", "skipped", "skipped", "done"]);
});

test("tasks without stage history count every earlier stage as done", () => {
  assert.deepEqual(stepStates({ stage: "test" }), ["done", "done", "done", "current", "todo"]);
});
