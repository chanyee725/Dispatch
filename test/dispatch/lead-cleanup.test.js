import { EventEmitter } from "node:events";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { Hub } from "../../server/dispatch/hub.js";
import { patchTeam, teamSettings } from "../../server/dispatch/settings.js";

function fixture({ automatic = true, status = "idle", card = true } = {}) {
  const lead = { id: "L", canSpawn: true, provider: "openai", status: "idle" };
  const sessions = { L: lead };
  const tasks = card ? { T: { id: "T", lead: "L", stage: "done", commit: "a".repeat(7), mergeCheck: { ok: true, commit: "a".repeat(40) } } } : {};
  const tickets = {};
  const team = { autoRemoveFinishedLeads: automatic };
  const store = { data: { sessions, tasks, tickets, settings: { team } }, save() {} };
  const spawnCli = mock.fn(() => { throw new Error("Cleanup must not start a CLI"); });
  const hub = new Hub({ root: "/tmp", store, models: [], roles: [], limits: new EventEmitter(), spawnCli });
  lead.status = status;
  const events = [];
  hub.on("leadFinished", e => events.push(e));
  const cleanup = hub.leadCleanup;
  return { hub, lead, tasks, tickets, sessions, cleanup, team, events };
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

test("automatic cleanup gives the lead and finished teammates the full grace period", () => {
  const { hub, lead, sessions, cleanup, events } = fixture();
  sessions.K = { id: "K", parent: lead.id, status: "done" };
  sessions.U = { id: "U", canSpawn: true, status: "idle" };
  const kill = mock.fn();
  hub.rt(lead.id).proc = { kill };
  const remove = mock.method(hub, "remove");
  cleanup.reconcile();

  mock.timers.tick(119_999);
  assert.ok(sessions.L);
  assert.ok(sessions.K);
  assert.deepEqual(events, []);
  mock.timers.tick(1);
  assert.deepEqual(Object.keys(sessions), ["U"]);
  assert.equal(kill.mock.callCount(), 1);
  assert.equal(hub.spawnCli.mock.callCount(), 0);
  assert.deepEqual(remove.mock.calls.map(c => c.arguments), [["K", { strict: true }], ["L", { strict: true }]]);
  assert.deepEqual(events, [{ id: "L", reason: "automatic" }]);
});

test("explicit finish works with auto cleanup disabled and waits for the final turn", () => {
  const { hub, lead, sessions, cleanup, events } = fixture({ automatic: false, status: "running", card: false });
  assert.deepEqual(cleanup.request(lead.id), { ok: true });
  mock.timers.tick(240_000);
  assert.ok(sessions.L);
  hub.rt("L").lastText = "done";
  hub.touch(lead, { status: "idle", turns: 1 });
  mock.timers.tick(119_999);
  assert.ok(sessions.L);
  mock.timers.tick(1);
  assert.deepEqual(events, [{ id: "L", reason: "explicit" }]);
  assert.equal(sessions.L, undefined);
});

test("automatic and repeated explicit finish share one grace timer and one event", () => {
  const { lead, cleanup, events, team } = fixture();
  cleanup.reconcile();
  mock.timers.tick(60_000);
  assert.deepEqual(cleanup.request(lead.id), { ok: true });
  assert.deepEqual(cleanup.request(lead.id), { ok: true });
  team.autoRemoveFinishedLeads = false;
  mock.timers.tick(60_000);
  assert.deepEqual(events, [{ id: "L", reason: "explicit" }]);
  mock.timers.tick(120_000);
  assert.equal(events.length, 1);
});

const blockers = [
  ["user question", "waiting", ({ lead }) => { lead.asksUser = true; }],
  ["permission", "waiting", ({ hub }) => { hub.rt("L").perms.set("permission", {}); }],
  ["queued user message", "waiting", ({ hub }) => { hub.rt("L").leadInbox.push({}); }],
  ["open ticket", "ticket", ({ tickets }) => { tickets.R = { lead: "L", status: "open" }; }],
  ["unfinished card", "board", ({ tasks }) => { tasks.T.stage = "merge"; }],
  ["unverified card", "board", ({ tasks }) => { delete tasks.T.mergeCheck; }],
  ["proof for a different SHA", "board", ({ tasks }) => { tasks.T.commit = "b".repeat(7); }],
  ["issue-linked PR without evidence for the named candidate", "board", ({ tasks }) => {
    Object.assign(tasks.T.mergeCheck, { via: "pr", candidate: tasks.T.commit, issue: 23 });
  }],
  ["closed issue without merge evidence", "board", ({ tasks }) => { tasks.T.mergeCheck.via = "issue"; }],
  ["active teammate", "team", ({ sessions }) => { sessions.K = { id: "K", parent: "L", status: "idle" }; }],
  ["active descendant behind a stopped teammate", "team", ({ sessions }) => {
    sessions.K = { id: "K", parent: "L", status: "done" };
    sessions.G = { id: "G", parent: "K", status: "running" };
  }],
];

for (const [label, reason, block] of blockers) {
  test(`both finish paths preserve a lead with ${label}`, () => {
    const f = fixture();
    f.cleanup.reconcile();
    block(f);
    assert.deepEqual(f.cleanup.request("L"), { ok: false, reason });
    // No hub event: the timeout must read the live state again.
    mock.timers.tick(120_000);
    assert.equal(f.sessions.L, f.lead);
    assert.deepEqual(f.events, []);
  });
}

test("an interrupted turn or a completed turn without a report does not finalize an explicit request", () => {
  for (const turns of [0, 1]) {
    const { hub, lead, sessions, cleanup, events } = fixture({ status: "running", automatic: false, card: false });
    assert.deepEqual(cleanup.request("L"), { ok: true });
    hub.touch(lead, { status: "idle", turns });
    mock.timers.tick(120_000);
    assert.ok(sessions.L);
    assert.deepEqual(events, []);
  }
});

test("updating the commit of a closed card revokes its previous merge evidence", async () => {
  const { hub, cleanup, tasks, sessions } = fixture();
  cleanup.reconcile();
  await hub.setTask("L", { id: "T", commit: "fix/pending" });
  assert.equal(tasks.T.mergeCheck, null);
  mock.timers.tick(120_000);
  assert.ok(sessions.L);
  assert.deepEqual(cleanup.request("L"), { ok: false, reason: "board" });
});

test("shutdown cancels the grace period before any removal", () => {
  const { hub, cleanup, sessions, events } = fixture();
  cleanup.reconcile();
  hub.stopAll();
  mock.timers.tick(120_000);
  assert.ok(sessions.L);
  assert.deepEqual(events, []);
});

test("a new turn during the explicit grace period cancels that request", () => {
  const { hub, lead, sessions, cleanup, events } = fixture({ automatic: false });
  assert.deepEqual(cleanup.request("L"), { ok: true });
  mock.timers.tick(60_000);
  hub.touch(lead, { status: "running" });
  hub.touch(lead, { status: "idle" });
  mock.timers.tick(240_000);
  assert.ok(sessions.L);
  assert.deepEqual(events, []);
});

test("a question in the final answer cancels an explicit finish requested in that turn", () => {
  const { hub, lead, sessions, cleanup, events } = fixture({ status: "running" });
  assert.deepEqual(cleanup.request("L"), { ok: true });
  hub.rt("L").lastText = "어느 쪽으로 할까요?";
  hub.touch(lead, { status: "idle", turns: 1 });
  mock.timers.tick(120_000);
  assert.ok(sessions.L);
  assert.deepEqual(events, []);
});

test("a reopened card ends the old grace period even if the card closes again before expiry", () => {
  const { hub, tasks, sessions, cleanup, events } = fixture();
  cleanup.reconcile();
  mock.timers.tick(90_000);
  tasks.T.stage = "merge";
  hub.emit("tasks", hub.tasks);
  tasks.T.stage = "done";
  hub.emit("tasks", hub.tasks);
  mock.timers.tick(30_000);
  assert.ok(sessions.L);
  mock.timers.tick(90_000);
  assert.deepEqual(events, [{ id: "L", reason: "automatic" }]);
});

test("turning off the setting during grace preserves an automatically scheduled lead", () => {
  const { team, sessions, cleanup, events } = fixture();
  cleanup.reconcile();
  team.autoRemoveFinishedLeads = false;
  mock.timers.tick(120_000);
  assert.ok(sessions.L);
  assert.deepEqual(events, []);
});

test("lead cleanup is opt-in and has a setting independent of teammate cleanup", () => {
  const store = { data: { settings: { team: {} } } };
  const options = { roles: [], models: [] };
  assert.equal(teamSettings(store).autoRemoveFinishedLeads, false);
  const enabled = patchTeam(store, { autoRemoveFinishedLeads: true, autoRemoveDone: false }, options);
  assert.equal(enabled.autoRemoveFinishedLeads, true);
  assert.equal(enabled.autoRemoveDone, false);
  const disabled = patchTeam(store, { autoRemoveFinishedLeads: false }, options);
  assert.equal(disabled.autoRemoveFinishedLeads, false);
  assert.equal(disabled.autoRemoveDone, false);
});
