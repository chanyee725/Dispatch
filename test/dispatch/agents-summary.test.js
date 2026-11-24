// GET /api/agents/summary (#755): the compact JSON the Claude Code mod pane polls. Metadata only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentsSummary, paneStatus } from "../../server/dispatch/agents-summary.js";
import { routeTable } from "../../server/dispatch/routes.js";

const NOW = 1_800_000_000_000;
const M = 60_000;

const lead = { id: "L", name: "관리자", role: "lead", model: "claude-opus-5-5", modelLabel: "Opus 5.5", state: "working", parent: null,
  branch: "dispatch/lead-1", last: "SECRET transcript line", prompt: "SECRET prompt", accountLabel: "acct", providerSessionId: "psid", cwd: "/home/x/proj" };
const impl = { id: "I", name: "구현자", role: "impl", model: "gemini-flash", state: "waiting", parent: "L", branch: "feat/755-agents-summary", last: "SECRET" };
const rev = { id: "R", name: "리뷰어", role: "reviewer", model: "claude-opus-5-5", modelLabel: "Opus 5.5", state: "resting", parent: "L", issue: 760 };
const other = { id: "O", name: "다른 관리자", role: "lead", model: "m", state: "done", parent: null };
const tasks = [
  { id: "t1", lead: "L", title: "엔드포인트", stage: "impl", owner: "I", etaAt: NOW - 5 * M, stageAt: NOW - 20 * M, note: "SECRET note",
    stuck: { reason: "over-eta", label: "예상 10분의 1.5배를 넘겼어요" } },
  { id: "t2", lead: "L", title: "끝난 일", stage: "done", owner: "R" },
  { id: "t3", lead: "O", title: "다른 일", stage: "plan", owner: null, etaAt: null, createdAt: NOW - M },
];
const limits = { five: 0.42, seven: 0.1, fiveReset: NOW + 3600e3, sevenReset: NOW + 86400e3, fable: 0.9 };
const issues = { ok: true, issues: [{ number: 755, title: "x", prs: [{ number: 900, state: "open", url: "https://github.com/o/r/pull/900", branch: "feat/755-x" }] }] };

test("paneStatus maps session states to running / asking / idle", () => {
  assert.equal(paneStatus("working"), "running");
  assert.equal(paneStatus("stuck"), "running");
  assert.equal(paneStatus("waiting"), "asking");
  assert.equal(paneStatus("resting"), "idle");
  assert.equal(paneStatus("done"), "done");
  assert.equal(paneStatus(undefined), "idle");
});

test("summary has usage, leads with open tasks, team and issue PRs", () => {
  const s = agentsSummary({ project: { name: "proj" }, limits, sessions: [lead, impl, rev, other], tasks, issues, now: NOW });
  assert.equal(s.v, 1);
  assert.deepEqual(s.usage, { fiveHour: { used: 42, reset: NOW + 3600e3 }, weekly: { used: 10, reset: NOW + 86400e3 } });
  assert.deepEqual(s.leads.map(l => [l.name, l.status]), [["관리자", "running"], ["다른 관리자", "done"]]);
  const [l] = s.leads;
  assert.equal(l.model, "Opus 5.5");
  assert.deepEqual(l.team, [
    { name: "구현자", role: "impl", model: "gemini-flash", status: "asking", stuck: false, issue: 755 },
    { name: "리뷰어", role: "reviewer", model: "Opus 5.5", status: "idle", stuck: false, issue: 760 },
  ]);
  assert.deepEqual(l.issues, [{ number: 755, prs: [{ number: 900, state: "open" }] }, { number: 760, prs: [] }]);
  assert.deepEqual(l.tasks, [{ title: "엔드포인트", stage: "impl", owner: "구현자", etaAt: NOW - 5 * M, late: true,
    stuck: "예상 10분의 1.5배를 넘겼어요", updatedAt: NOW - 20 * M }]);
  assert.equal(s.leads[1].tasks[0].owner, null);
  // A past estimated ETA (#1028) does not mark the task late.
  const est = agentsSummary({ sessions: [lead], tasks: [{ ...tasks[0], stuck: null, etaEstimated: true }], now: NOW });
  assert.equal(est.leads[0].tasks[0].late, false);
});

test("summary carries no transcript text, account labels, ids or paths", () => {
  const json = JSON.stringify(agentsSummary({ project: { name: "proj" }, limits, sessions: [lead, impl, rev], tasks, issues, now: NOW }));
  for (const bad of ["SECRET", "acct", "psid", "/home/x", "github.com", "\"id\"", "dispatch/lead-1", "fable"]) assert.ok(!json.includes(bad), bad);
});

test("empty state answers a valid summary", () => {
  const s = agentsSummary({ project: { name: "p" }, now: NOW });
  assert.deepEqual(s.usage, { fiveHour: { used: null, reset: null }, weekly: { used: null, reset: null } });
  assert.deepEqual(s.leads, []);
});

function route(d) {
  const hits = routeTable(d).filter(([, re]) => re.test("/api/agents/summary"));
  assert.equal(hits.length, 1);
  assert.equal(hits[0][0], "GET");
  return q => hits[0][2]([], {}, new URL(`http://127.0.0.1/api/agents/summary${q ?? ""}`));
}

function fakeHub() {
  return { sessions: [lead, impl], tasks, currentLimits: () => limits, publicSession: s => ({ ...s }) };
}

test("GET /api/agents/summary reads the hub and the cached issue list; ?pr=0 skips it", async () => {
  let calls = 0;
  const get = route({ root: "/tmp/scratch/proj", store: {}, hub: fakeHub(), models: [], broadcast: () => {}, issues: async () => { calls++; return issues; } });
  const s = await get();
  assert.equal(s.project.name, "proj");
  assert.deepEqual(s.leads[0].issues, [{ number: 755, prs: [{ number: 900, state: "open" }] }]);
  assert.equal(calls, 1);
  const s2 = await get("?pr=0");
  assert.deepEqual(s2.leads[0].issues, [{ number: 755, prs: [] }]);
  assert.equal(calls, 1);
});

test("GET /api/agents/summary still answers when the issue list fails or is off", async () => {
  const failing = route({ root: "/p", store: {}, hub: fakeHub(), models: [], broadcast: () => {}, issues: async () => { throw new Error("gh"); } });
  assert.equal((await failing()).leads.length, 1);
  const off = route({ root: "/p", store: {}, hub: fakeHub(), models: [], broadcast: () => {} });
  assert.deepEqual((await off()).leads[0].issues, [{ number: 755, prs: [] }]);
});
