import { test } from "node:test";
import assert from "node:assert/strict";
import { enterStage } from "../../server/dispatch/tasks.js";

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

import { defaultEta, stageMedianMinutes } from "../../server/dispatch/tasks.js";
import { Hub } from "../../server/dispatch/hub.js";

const done = (...spans) => {
  // spans: [stage, minutes] visited in order, then done (closed with a confirmed merge)
  const stages = [];
  let at = 0;
  for (const [stage, min] of spans) { stages.push({ stage, at }); at += min * M; }
  stages.push({ stage: "done", at });
  return { stage: "done", stages, mergeCheck: { ok: true } };
};

test("stageMedianMinutes: median of the same stage in finished tasks only (#1028)", () => {
  const tasks = [
    done(["plan", 2], ["impl", 10], ["review", 4]),
    done(["plan", 1], ["impl", 30], ["review", 6]),
    done(["impl", 20], ["review", 5], ["impl", 6]),
    { stage: "review", stages: [{ stage: "review", at: 0 }, { stage: "test", at: 99 * M }] },
  ];
  assert.equal(stageMedianMinutes(tasks, "impl"), 15); // 6, 10, 20, 30
  assert.equal(stageMedianMinutes(tasks, "review"), 5);
  assert.equal(stageMedianMinutes(tasks, "test"), null, "an open task's stages don't count");
  assert.equal(stageMedianMinutes(tasks, "blocked"), null);
  assert.equal(stageMedianMinutes([], "impl"), null);
});

test("stageMedianMinutes: only merged tasks count, and a stage passed in under a minute is left out", () => {
  const dropped = { ...done(["impl", 2]), mergeCheck: { ok: null } }; // closed without a commit
  const failed = { ...done(["impl", 3]), mergeCheck: { ok: false } };
  const tasks = [done(["plan", 0.5], ["impl", 40]), dropped, failed, done(["plan", 0.2], ["impl", 50])];
  assert.equal(stageMedianMinutes(tasks, "impl"), 45);
  assert.equal(stageMedianMinutes(tasks, "plan"), null);
});

test("defaultEta keeps a lead ETA still ahead, else estimates or clears", () => {
  const hist = [done(["review", 8])];
  const lead = { stage: "review", etaAt: 50 * M, etaEstimated: false };
  defaultEta(lead, hist, 10 * M);
  assert.equal(lead.etaAt, 50 * M);
  const late = { stage: "review", etaAt: 5 * M, etaEstimated: false };
  defaultEta(late, hist, 10 * M);
  assert.deepEqual([late.etaAt, late.etaEstimated], [18 * M, true]);
  const none = { stage: "test", etaAt: 20 * M, etaEstimated: true };
  defaultEta(none, hist, 10 * M);
  assert.deepEqual([none.etaAt, none.etaEstimated, none.etaSetAt], [null, false, null]);
  const blocked = { stage: "blocked", etaAt: null };
  defaultEta(blocked, hist, 0);
  assert.equal(blocked.etaAt, null);
});

test("setTask fills etaAt from history on a new stage without eta_minutes", async () => {
  const hub = Object.assign(Object.create(Hub.prototype), {
    live: new Map(),
    store: { data: { sessions: { lead: { id: "lead", parent: null } }, settings: {}, tasks: { old: { id: "old", lead: "lead", title: "지난 일", ...done(["plan", 3], ["review", 12]) } } }, save() {} },
  });
  hub.emit = () => true;
  const t = await hub.setTask("lead", { title: "새 일" });
  assert.equal(t.etaEstimated, true);
  assert.ok(Math.abs(t.etaAt - Date.now() - 3 * M) < 5000);
  assert.match(hub.boardNote("lead"), /분 남음\(예상\)/, "the lead sees the estimate is not its own promise");
  await hub.setTask("lead", { id: t.id, stage: "impl" });
  assert.deepEqual([t.etaAt, t.etaEstimated], [null, false], "no impl history: empty");
  await hub.setTask("lead", { id: t.id, stage: "review", eta_minutes: 40 });
  assert.equal(t.etaEstimated, false);
  await hub.setTask("lead", { id: t.id, stage: "test" });
  assert.ok(t.etaAt - Date.now() > 39 * M, "the lead's ETA still ahead stays");
  assert.match(hub.boardNote("lead"), /분 남음\)/);
  assert.equal(t.stuck, null);
});
