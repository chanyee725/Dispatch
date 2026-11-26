import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { Hub } from "../../server/dispatch/hub.js";
import { SharedLimits } from "../../server/dispatch/limits.js";
import { ctxShare, mtokens } from "../../server/dispatch/state.js";
import { onJsonLines } from "../../server/dispatch/hub-util.js";

// Metadata-only projection of Codex app-server v2 notifications, with synthetic IDs and counts.
const THREAD = "thread-1";
const TURN = "turn-1";
const counts = (input, cached, output, write = 0) => ({
  inputTokens: input, cachedInputTokens: cached, cacheWriteInputTokens: write,
  outputTokens: output, reasoningOutputTokens: output / 2, totalTokens: input + output,
});
const update = (total, last, modelContextWindow = 272000, turnId = TURN, threadId = THREAD) => ({
  method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage: { total, last, modelContextWindow } },
});
const compaction = method => ({ method, params: { threadId: THREAD, turnId: TURN, item: { id: "compact-1", type: "contextCompaction" } } });
const finished = (id = TURN, status = "completed") => ({ method: "turn/completed", params: { threadId: THREAD, turn: { id, status } } });
const MODEL = { id: "gpt-test", provider: "openai", efforts: ["low"], contextWindow: 400000 };
const ROLE = { id: "impl", name: "impl", model: MODEL.id, perm: "plan" };

async function setup(t, old = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "dispatch-codex-context-"));
  const store = new Store(root);
  store.save = () => {};
  store.data.settings.team = { ctxHandoff: 70, handoffMTokens: 5, rotateOthers: 0 };
  store.data.sessions = old;
  const processes = [];
  const hub = new Hub({
    root, store, models: [MODEL], roles: [ROLE], port: 0,
    limits: new SharedLimits(path.join(root, "limits.json")),
    spawnCli: (bin, args) => {
      assert.equal(bin, "codex");
      assert.deepEqual(args.slice(0, 3), ["app-server", "--listen", "stdio://"]);
      const proc = Object.assign(new EventEmitter(), {
        requests: [], stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        kill: () => {}, send: msg => proc.stdout.write(JSON.stringify(msg) + "\n"),
      });
      onJsonLines(proc.stdin, request => proc.requests.push(request));
      processes.push(proc);
      return proc;
    },
  });
  t.after(() => { hub.stopAll(); rmSync(root, { recursive: true, force: true }); });
  return { hub, store, processes };
}

function handshake(proc, { resume = false, turnId = TURN, replay = null } = {}) {
  assert.equal(proc.requests[0].method, "initialize");
  proc.send({ id: 1, result: {} });
  assert.equal(proc.requests[1].method, "initialized");
  assert.equal(proc.requests[2].method, resume ? "thread/resume" : "thread/start");
  assert.equal(proc.requests[2].params.approvalPolicy, "never");
  assert.equal(proc.requests[2].params.sandbox, "read-only");
  if (resume) assert.equal(proc.requests[2].params.threadId, THREAD);
  proc.send({ id: 2, result: { thread: { id: THREAD }, approvalPolicy: "never", sandbox: { type: "readOnly" } } });
  if (replay) proc.send(replay);
  assert.equal(proc.requests[3].method, "turn/start");
  assert.equal(proc.requests[3].params.effort, "low");
  const turn = { id: turnId, status: "inProgress" };
  proc.send({ method: "turn/started", params: { threadId: THREAD, turn } });
  proc.send({ id: 3, result: { turn } });
}

test("3.18M Codex tokens stay cumulative while provider context shrinks and duplicate events are ignored", async t => {
  const { hub, store, processes } = await setup(t);
  const [session] = await hub.create({ items: [{ role: ROLE.id, effort: "low" }], commonPrompt: "test", worktree: false });
  const s = hub.get(session.id);
  const first = processes[0];
  handshake(first);

  assert.equal(s.ctx, null);
  assert.equal(ctxShare(s), null);
  const total = counts(3_100_000, 2_400_000, 80_000, 100_000);
  const high = update(total, counts(230_000, 180_000, 10_000, 10_000));
  first.send(high);
  first.send(high);
  assert.equal(mtokens(s), 3.18);
  assert.equal(s.ctxHigh.pct, 88);
  assert.equal(s.ctxWindow, 272000);

  first.send(compaction("item/started"));
  first.send(high);
  assert.equal(ctxShare(s), null);
  assert.equal(s.ctxHigh, null);
  const compacted = update(total, counts(49_000, 39_000, 1_000));
  first.send(compacted);
  first.send(compaction("item/completed"));
  first.send(high);
  assert.equal(ctxShare(s), 50_000 / 272_000);
  assert.equal(mtokens(s), 3.18);

  first.send(finished());
  first.send(finished());
  assert.equal(s.turns, 1);
  assert.deepEqual(s.usage, { input: 600_000, cacheRead: 2_400_000, cacheWrite: 100_000, output: 80_000 });
  assert.deepEqual(Object.values(store.data.daily)[0].models[MODEL.id], { ...s.usage, cost: 0 });

  first.emit("close", 0);
  hub.send(s.id, "test");
  const second = processes[1];
  handshake(second, { resume: true, turnId: "turn-2", replay: compacted });
  assert.equal(ctxShare(s), null);
  first.send(high);
  second.send(high);
  second.send(update(total, counts(49_000, 39_000, 1_000), 272000, "turn-2"));
  second.send(update(counts(4_000_000, 2_400_000, 80_000), counts(1, 0, 0), 272000, "turn-2", "other-thread"));
  assert.equal(ctxShare(s), null);
  const nextTotal = counts(3_120_000, 2_415_000, 81_000, 101_000);
  second.send(update(nextTotal, counts(20_000, 15_000, 1000, 1000), null, "turn-2"));
  assert.equal(ctxShare(s), null);
  second.send(update(nextTotal, counts(20_000, 15_000, 1000, 1000), 300_000, "turn-2"));
  second.send(finished("turn-2"));
  assert.equal(s.turns, 2);
  assert.equal(ctxShare(s), 21_000 / 300_000);
  assert.equal(mtokens(s), 3.201);
});

test("a resumed Codex turn without replay counts the first request once", async t => {
  const { hub, store, processes } = await setup(t);
  const [session] = await hub.create({ items: [{ role: ROLE.id, effort: "low" }], commonPrompt: "test", worktree: false });
  const s = hub.get(session.id);
  const first = processes[0];
  handshake(first);
  first.send(update(counts(1_000, 700, 100, 40), counts(1_000, 700, 100, 40)));
  first.send(finished());
  first.emit("close", 0);
  const before = mtokens(s);

  hub.send(s.id, "test");
  const second = processes[1];
  handshake(second, { resume: true, turnId: "turn-2" });
  const firstUsage = update(counts(1_100, 760, 110, 45), counts(100, 60, 10, 5), 272000, "turn-2");
  second.send(firstUsage);
  second.send(firstUsage);

  assert.equal(s.ctx, 110);
  assert.equal(Math.round((mtokens(s) - before) * 1_000_000), 110);
  assert.deepEqual(s.usage, { input: 295, cacheRead: 760, cacheWrite: 45, output: 110 });
  assert.deepEqual(Object.values(store.data.daily)[0].models[MODEL.id], { ...s.usage, cost: 0 });
});

test("old saved Codex totals are preserved and a turn with no snapshot stays unknown", async t => {
  const saved = {
    id: "old", status: "idle", provider: "openai", model: MODEL.id, role: ROLE.id,
    perm: "plan", effort: "low", providerSessionId: THREAD, turns: 1,
    ctx: 3_180_000, ctxWindow: 272000, ctxHigh: { pct: 1169 },
    usage: { input: 600_000, cacheRead: 2_400_000, cacheWrite: 100_000, output: 80_000 },
  };
  const { hub, processes } = await setup(t, { old: saved });
  assert.equal(ctxShare(saved), null);
  assert.equal(saved.ctxHigh, null);
  assert.equal(mtokens(saved), 3.18);
  hub.start(saved, "test");
  handshake(processes[0], { resume: true });
  processes[0].send(finished());
  assert.equal(ctxShare(saved), null);
  assert.equal(mtokens(saved), 3.18);
});

test("unexpected provider requests cannot grant approvals and failed turns stay failed on close", async t => {
  const { hub, processes } = await setup(t);
  const [session] = await hub.create({ items: [{ role: ROLE.id, effort: "low" }], commonPrompt: "test", worktree: false });
  const proc = processes[0];
  handshake(proc);
  proc.send({ id: 8, method: "item/commandExecution/requestApproval", params: {} });
  assert.equal(proc.requests.at(-1).id, 8);
  assert.equal(proc.requests.at(-1).error.code, -32000);
  proc.send(finished(TURN, "failed"));
  proc.emit("close", 0);
  assert.equal(hub.get(session.id).status, "error");
  assert.equal(hub.get(session.id).turns, 0);
});

test("a confirmed looser sandbox stops before turn/start", async t => {
  const { hub, processes } = await setup(t);
  const [session] = await hub.create({ items: [{ role: ROLE.id, effort: "low" }], commonPrompt: "test", worktree: false });
  const proc = processes[0];
  proc.send({ id: 1, result: {} });
  proc.send({ id: 2, result: { thread: { id: THREAD }, approvalPolicy: "never", sandbox: { type: "workspaceWrite" } } });
  assert.equal(proc.requests.some(req => req.method === "turn/start"), false);
  assert.equal(hub.get(session.id).status, "error");
});

for (const [automatic, idleRetry] of [[false, false], [true, false], [false, true]]) {
  const scenario = idleRetry ? "a fresh idle Codex finish gets its own grace period"
    : `Codex commentary cannot satisfy finish with automatic cleanup ${automatic ? "on" : "off"}`;
  test(scenario, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const lead = {
      id: "L", status: "idle", provider: "openai", model: MODEL.id, role: ROLE.id,
      perm: "plan", effort: "low", turns: 0, canSpawn: true,
    };
    const { hub, store, processes } = await setup(t, { L: lead });
    const cleanup = hub.leadCleanup;
    hub.startCodex(lead, "test");
    handshake(processes[0]);
    store.data.tasks ??= {};
    store.data.tasks.T = { id: "T", lead: lead.id, stage: "done", commit: "a".repeat(7), mergeCheck: { ok: true, commit: "a".repeat(40) } };
    store.data.settings.team.autoRemoveFinishedLeads = automatic;
    cleanup.settingsChanged();

    const item = (proc, turnId, item) => proc.send({ method: "item/completed", params: { threadId: THREAD, turnId, item } });
    item(processes[0], TURN, { type: "agentMessage", id: "progress", phase: "commentary", text: "Finishing now." });
    assert.deepEqual(cleanup.request(lead.id), { ok: true });
    item(processes[0], TURN, { type: "mcpToolCall", id: "tool", server: "dispatch", tool: "finish", status: "completed" });
    item(processes[0], TURN, { type: "agentMessage", id: "post-tool", phase: "commentary", text: "The finish tool returned." });
    processes[0].send(finished());
    processes[0].emit("close", 0);

    assert.equal(cleanup.scheduled(lead), false);
    cleanup.reconcile();
    assert.equal(cleanup.scheduled(lead), false);
    t.mock.timers.tick(120_000);
    assert.equal(hub.get(lead.id), lead);

    if (idleRetry) {
      assert.deepEqual(cleanup.request(lead.id), { ok: true });
      assert.equal(cleanup.scheduled(lead), true);
      t.mock.timers.tick(119_999);
      assert.equal(hub.get(lead.id), lead);
      t.mock.timers.tick(1);
      assert.equal(hub.get(lead.id), undefined);
      return;
    }

    hub.startCodex(lead, "test");
    const nextTurn = "turn-2";
    handshake(processes[1], { resume: true, turnId: nextTurn });
    if (!automatic) assert.deepEqual(cleanup.request(lead.id), { ok: true });
    item(processes[1], nextTurn, { type: "agentMessage", id: "report", phase: "final_answer", text: "Work complete." });
    processes[1].send(finished(nextTurn));
    assert.equal(cleanup.scheduled(lead), true);
    t.mock.timers.tick(120_000);
    assert.equal(hub.get(lead.id), undefined);
  });
}
