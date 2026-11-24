// Review fixes for E11 (#106): modes and efforts are checked on create, no session runs looser than
// the chosen mode, and limit tickets keep reply clips out of state.json.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkEffort, checkPerm, Hub } from "../../server/dispatch/hub.js";
import { diskView, Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";
import { FAKE_MARKER } from "../../server/dispatch/cli.js";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const MODELS = [
  { id: "claude-fable-5-2", provider: "claude", efforts: ["low", "medium", "high"], contextWindow: 200000 },
];
const ROLES = [{ id: "impl", name: "구현자", model: "claude-fable-5-2", perm: "auto", prompt: "" }];

async function makeHub() {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-dispatch-guard-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  const limits = new SharedLimits(path.join(root, "limits.json"));
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits });
  return { root, store, hub };
}

test("checkPerm accepts the four modes and refuses everything else", () => {
  for (const p of ["manual", "acceptEdits", "auto", "plan"]) assert.equal(checkPerm("claude", p), p);
  for (const bad of ["bypassPermissions", "", undefined, "dontAsk"]) {
    assert.throws(() => checkPerm("claude", bad), e => e.status === 400);
  }
});

test("checkEffort only passes the model's own plain effort words", () => {
  const m = { efforts: ["low", "high"] };
  assert.equal(checkEffort(m, null), null);
  assert.equal(checkEffort(m, ""), null);
  assert.equal(checkEffort(m, "high"), "high");
  assert.throws(() => checkEffort(m, "max"), e => e.status === 400);
  assert.throws(() => checkEffort(m, 'high"\nsandbox_mode="danger-full-access'), e => e.status === 400);
  // A catalog value that is not a plain word is never trusted.
  assert.throws(() => checkEffort({ efforts: ['x"y'] }, 'x"y'), e => e.status === 400);
});

test("create refuses a bad perm or effort before making any session", async () => {
  const { store, hub } = await makeHub();
  const cases = [
    [{ role: "impl", perm: "bypassPermissions" }],
    [{ role: "impl", effort: "ultra" }],
    [{ role: "impl", effort: 'high"\nsandbox_mode="danger-full-access' }],
    // One good item and one bad one: nothing is made.
    [{ role: "impl" }, { role: "impl", perm: "bypassPermissions" }],
  ];
  for (const items of cases) {
    await assert.rejects(hub.create({ items, commonPrompt: "hi", worktree: false }), e => e.status === 400, JSON.stringify(items));
  }
  assert.deepEqual(store.data.sessions, {});
  assert.equal(store.data.seq, 0);
});

function oldSession(root, provider, model) {
  return {
    id: `old-${provider}`, n: 1, name: "Old", role: "impl", provider, model,
    effort: null, perm: "manual", prompt: "", canSpawn: false, cwd: root, status: "idle", startedAt: 0, updatedAt: 0,
    last: "", turns: 0, ctx: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, providerSessionId: null,
  };
}

test("a saved gemini or openai session is stopped by start(), never spawned", async () => {
  const { root, store, hub } = await makeHub();
  let spawned = 0;
  hub.spawnCli = () => { spawned++; throw new Error("must not spawn"); };
  for (const [provider, model] of [["gemini", "gemini-3.8-flash-low"], ["openai", "gpt-x"]]) {
    const s = oldSession(root, provider, model);
    store.data.sessions[s.id] = s;
    hub.start(s, "hi");
    assert.equal(s.status, "error", provider);
  }
  assert.equal(spawned, 0);
  assert.throws(() => hub.setPerm("old-gemini", "bypassPermissions"), e => e.status === 400);
});

test("limit tickets keep leadLast and team[].last in memory only", async () => {
  const { root, store } = await makeHub();
  store.data.tickets = {
    t1: {
      id: "t1", lead: "a", status: "open", reason: "5시간 한도", items: [{ title: "x", stage: "doing" }],
      leadLast: "secret lead reply", team: [{ name: "Juno", status: "running", branch: "feat/x", last: "secret team reply" }],
    },
  };
  const view = diskView(store.data);
  assert.equal("leadLast" in view.tickets.t1, false);
  assert.deepEqual(view.tickets.t1.team, [{ name: "Juno", status: "running", branch: "feat/x" }]);
  // Memory still has them for the resume message.
  assert.equal(store.data.tickets.t1.leadLast, "secret lead reply");
  await store.flush();
  const disk = readFileSync(path.join(root, ".dispatch", "state.json"), "utf8");
  assert.doesNotMatch(disk, /secret/);
  assert.equal(JSON.parse(disk).tickets.t1.team[0].branch, "feat/x");
});
