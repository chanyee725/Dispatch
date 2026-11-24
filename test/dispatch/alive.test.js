// #775: Hub.alive() decides whether a running plan's lead still blocks a folder switch. Calls the real method on a
// real Hub (no CLI is started: attach() gets a stand-in process object).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const MODELS = [
  { id: "claude-fable-5-2", provider: "claude", efforts: ["low"], contextWindow: 200000 },
  { id: "gpt-5", provider: "codex", efforts: ["low"], contextWindow: 200000 },
];
const ROLES = [{ id: "lead", name: "관리자", model: "claude-fable-5-2", perm: "auto", prompt: "ROLE PROMPT" }];
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const session = (id, provider, status, extra = {}) =>
  ({ id, n: 1, name: id, role: "lead", provider, model: provider === "codex" ? "gpt-5" : "claude-fable-5-2", status, usage, ...extra });

function fakeProc() {
  const p = new EventEmitter();
  p.stderr = new EventEmitter();
  p.kill = () => {};
  return p;
}

test("alive: per-turn lead idle between turns, interrupted lead and live process count; stale or done do not", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-alive-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  store.save = () => {};
  Object.assign(store.data.sessions, {
    // Saved idle before the restart and never ran since: no lead left for its plan.
    stale: session("stale", "claude", "idle"),
    // Mid-turn when the server stopped: the constructor marks it interrupted, waiting for its auto-resume.
    cut: session("cut", "claude", "running"),
    codex: session("codex", "codex", "idle"),
    claude: session("claude", "claude", "idle"),
    gone: session("gone", "claude", "done"),
  });
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")),
    spawnCli: () => { throw Object.assign(new Error("no CLI in this test"), { code: "ECLIDENIED" }); } });
  after(() => hub.stopAll());

  assert.equal(hub.alive("nobody"), false);
  assert.equal(hub.alive("gone"), false);
  assert.equal(hub.alive("stale"), false);
  assert.equal(store.data.sessions.cut.status, "idle");
  assert.equal(store.data.sessions.cut.interrupted, true);
  assert.equal(hub.alive("cut"), true, "interrupted lead waits for its auto-resume");

  // A Codex turn: one process per turn, gone again when the turn ends.
  assert.equal(hub.alive("codex"), false);
  const cx = store.data.sessions.codex;
  const p = fakeProc();
  hub.attach(cx, p);
  hub.mark(cx, { status: "running" });
  assert.equal(hub.alive("codex"), true);
  hub.mark(cx, { status: "idle" });
  p.emit("exit", 0);
  assert.equal(hub.live.get("codex").proc, null);
  assert.equal(cx.status, "idle");
  assert.equal(hub.alive("codex"), true, "codex lead idle between turns is still alive");

  // A Claude lead whose process is up while idle.
  const cl = store.data.sessions.claude;
  hub.attach(cl, fakeProc());
  assert.equal(hub.alive("claude"), true);

  // Done ends it whatever ran before.
  hub.mark(cx, { status: "done" });
  assert.equal(hub.alive("codex"), false);
});
