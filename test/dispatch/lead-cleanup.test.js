import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { Hub } from "../../server/dispatch/hub.js";
import { patchTeam, teamSettings } from "../../server/dispatch/settings.js";

function fixture({ automatic = true, status = "idle", card = true, root = "/tmp" } = {}) {
  const lead = { id: "L", canSpawn: true, provider: "openai", status: "idle" };
  const sessions = { L: lead };
  const tasks = card ? { T: { id: "T", lead: "L", stage: "done", commit: "a".repeat(7), mergeCheck: { ok: true, commit: "a".repeat(40) } } } : {};
  const tickets = {};
  const team = { autoRemoveFinishedLeads: automatic };
  const store = { data: { sessions, tasks, tickets, settings: { team } }, save() {} };
  const spawnCli = mock.fn(() => { throw new Error("Cleanup must not start a CLI"); });
  const hub = new Hub({ root, store, models: [], roles: [], limits: new EventEmitter(), spawnCli });
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

for (const automatic of [true, false]) {
  test(`${automatic ? "automatic" : "explicit"} lead cleanup preserves finished teammates with undelivered reports`, () => {
    const { hub, lead, sessions, cleanup, events } = fixture({ automatic });
    const teammate = sessions.K = { id: "K", parent: lead.id, status: "done" };
    const queue = hub.rt(teammate.id).pendingReports;
    hub.runBlock = () => "provider hold";
    hub.queueLeadReport(teammate, "Work complete.");
    assert.equal(queue.length, 1);

    cleanup.reconcile();
    assert.equal(cleanup.scheduled(lead), false);
    assert.deepEqual(cleanup.request(lead.id), { ok: false, reason: "waiting" });

    const report = queue.pop();
    if (automatic) cleanup.reconcile();
    else assert.deepEqual(cleanup.request(lead.id), { ok: true });
    assert.equal(cleanup.scheduled(lead), true);

    // A report can be queued after arming. Expiry checks the runtime even without a hub event.
    queue.push(report);
    mock.timers.tick(120_000);
    assert.equal(sessions.L, lead);
    assert.equal(sessions.K, teammate);
    assert.deepEqual(queue, [report]);
    assert.deepEqual(events, []);
  });
}

for (const finalText of [null, "Work complete."]) {
  test(`Claude finish ${finalText ? "accepts the post-tool final answer" : "rejects pre-tool text at turn end"}`, () => {
    const { hub, lead, sessions, cleanup, events } = fixture({ automatic: false, status: "running", card: false });
    Object.assign(lead, { provider: "claude", turns: 0 });
    const assistant = (...content) => hub.onClaude(lead, { type: "assistant", message: { content } });
    assistant({ type: "text", text: "I will finish now." }, { type: "tool_use", name: "finish", id: "finish" });
    assert.deepEqual(cleanup.request(lead.id), { ok: true });
    hub.onClaude(lead, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "finish", content: "{}" }] } });
    if (finalText) {
      // A post-request preamble from another tool must not count either.
      assistant({ type: "text", text: "Checking the result." }, { type: "tool_use", name: "check", id: "check" });
      assistant({ type: "text", text: finalText });
    }
    hub.onClaude(lead, { type: "result", subtype: "success", result: finalText ?? "" });
    assert.equal(cleanup.scheduled(lead), !!finalText);
    mock.timers.tick(119_999);
    assert.equal(sessions.L, lead);
    mock.timers.tick(1);
    assert.equal(sessions.L, finalText ? undefined : lead);
    assert.deepEqual(events, finalText ? [{ id: "L", reason: "explicit" }] : []);
  });
}

for (const retryFinish of [false, true]) {
  test(`Claude finish without a final answer blocks automatic rearming until a valid ${retryFinish ? "finish" : "report"}`, () => {
    const { hub, lead, sessions, cleanup, events } = fixture({ status: "running" });
    Object.assign(lead, { provider: "claude", turns: 0 });
    const assistant = (...content) => hub.onClaude(lead, { type: "assistant", message: { content } });
    const finish = () => {
      assistant({ type: "text", text: "I will finish now." }, { type: "tool_use", name: "finish", id: "finish" });
      assert.deepEqual(cleanup.request(lead.id), { ok: true });
      hub.onClaude(lead, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "finish", content: "{}" }] } });
    };
    finish();
    hub.onClaude(lead, { type: "result", subtype: "success", result: "" });
    assert.equal(cleanup.scheduled(lead), false);
    for (let cycle = 0; cycle < 5; cycle++) {
      cleanup.reconcile();
      assert.equal(cleanup.scheduled(lead), false, "a later automatic check must still require a final answer");
      mock.timers.tick(30_000);
    }
    assert.equal(sessions.L, lead);
    assert.deepEqual(events, []);

    if (retryFinish) finish();
    assistant({ type: "text", text: "Work complete." });
    hub.onClaude(lead, { type: "result", subtype: "success", result: "Work complete." });
    assert.equal(cleanup.scheduled(lead), true);
    mock.timers.tick(120_000);
    assert.equal(sessions.L, undefined);
    assert.deepEqual(events, [{ id: lead.id, reason: retryFinish ? "explicit" : "automatic" }]);
  });
}

function scratchGit(t) {
  const root = mkdtempSync(join(tmpdir(), "dispatch-lead-cleanup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  const commit = () => git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "test");
  git("init", "-qb", "develop");
  commit();
  git("switch", "-qc", "fix/candidate");
  commit();
  git("switch", "-q", "develop");
  git("merge", "-q", "--ff-only", "fix/candidate");
  return { root, git, commit };
}

for (const automatic of [true, false]) {
  test(`${automatic ? "auto-close" : "explicit done"} branch proof must still match at arming and expiry`, async t => {
    const { root, git, commit } = scratchGit(t);
    const { hub, lead, cleanup, tasks, sessions } = fixture({ root, automatic, status: "running", card: false });
    const ref = "fix/candidate";
    const card = await hub.setTask(lead.id, { title: "Merged work", stage: "merge", commit: ref });
    if (automatic) assert.deepEqual(await hub.autoCloseTasks(), [card.id]);
    else await hub.setTask(lead.id, { id: card.id, stage: "done" });
    const original = git("rev-parse", ref);
    assert.equal(card.mergeCheck.commit, original);

    git("switch", "-q", ref);
    commit();
    const unmerged = git("rev-parse", "HEAD");
    git("switch", "-q", "develop");
    lead.status = "idle";
    const settle = () => cleanup.pending.get(lead.id)?.checking;
    const arm = () => automatic ? cleanup.reconcile() : cleanup.request(lead.id);

    arm();
    await settle();
    assert.equal(cleanup.scheduled(lead), false, "moved ref cannot start grace");
    git("branch", "-D", ref);
    arm();
    await settle();
    assert.equal(cleanup.scheduled(lead), false, "unresolved ref cannot start grace");

    for (const move of [() => git("branch", "-f", ref, unmerged), () => git("branch", "-D", ref)]) {
      git("branch", "-f", ref, original);
      arm();
      await settle();
      assert.equal(cleanup.scheduled(lead), true);
      move();
      mock.timers.tick(120_000);
      await settle();
      assert.equal(sessions.L, lead, "moved or deleted ref cannot authorize removal");
      assert.equal(tasks[card.id], card);
    }

    git("branch", ref, original);
    arm();
    await settle();
    mock.timers.tick(120_000);
    await settle();
    assert.equal(sessions.L, undefined, "a ref matching the proof can authorize cleanup");
  });
}

for (const atExpiry of [false, true]) {
  for (const change of ["card", "lead"]) {
    test(`branch lookup rechecks the ${change} after awaiting Git at ${atExpiry ? "expiry" : "arming"}`, async t => {
      const { root, git } = scratchGit(t);
      const { lead, cleanup, tasks, sessions } = fixture({ root });
      const ref = "fix/candidate";
      const sha = git("rev-parse", ref);
      Object.assign(tasks.T, { commit: ref, mergeCheck: { ok: true, commit: sha, candidate: ref } });
      cleanup.reconcile();
      if (atExpiry) {
        await cleanup.pending.get(lead.id)?.checking;
        assert.equal(cleanup.scheduled(lead), true);
        mock.timers.tick(120_000);
      }
      const checking = cleanup.pending.get(lead.id)?.checking;
      if (change === "card") {
        // Both cards pass the structural check, but Git verified only the original.
        tasks.T = { ...tasks.T, commit: "other", mergeCheck: { ok: true, commit: sha, candidate: "other" } };
      } else lead.status = "running";
      await checking;
      assert.equal(sessions.L, lead);
      assert.equal(cleanup.scheduled(lead), false);
      assert.equal(cleanup.pending.has(lead.id), false);
    });
  }
}
