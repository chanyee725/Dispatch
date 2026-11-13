import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../sessions.js";
import { patchTeam, teamSettings } from "../settings.js";

// Auto-remove of finished teammates (issue #39) on a real Hub with fake CLI processes.
const fakeProc = () => { const lines = []; return { lines, stdin: { write: l => lines.push(JSON.parse(l)) }, kill() {} }; };
const said = proc => proc.lines.map(l => l.message?.content ?? "").join("\n---\n");
const flush = () => new Promise(r => setImmediate(r));

function makeHub(team = {}, root = mkdtempSync(join(tmpdir(), "dispatch-ar-"))) {
  const store = { data: { seq: 0, sessions: {}, tasks: {}, tickets: {}, settings: { guard: { enabled: false }, team } }, save() {}, addDaily() {} };
  const limits = Object.assign(new EventEmitter(), { claude: {} });
  const hub = new Hub({ root, store, models: [], roles: [], port: 0, limits });
  const add = (s, proc) => {
    store.data.sessions[s.id] = { provider: "claude", status: "idle", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, turns: 1, ...s };
    hub.rt(s.id).proc = proc;
    return store.data.sessions[s.id];
  };
  const leadProc = fakeProc();
  const lead = add({ id: "L", name: "Jae", roleName: "관리자", role: "lead", canSpawn: true }, leadProc);
  const kidProc = fakeProc();
  const kid = add({ id: "K", name: "Pax", roleName: "구현자", role: "impl", parent: "L", branch: "dispatch/impl-1" }, kidProc);
  // A teammate's turn ends with a report.
  const finish = (s = kid, text = "구현 끝, 커밋 abc123") => {
    hub.touch(s, { status: "running" });
    hub.rt(s.id).lastText = text;
    hub.touch(s, { status: "idle" });
    hub.reportToParent(s);
  };
  return { hub, store, lead, leadProc, kid, kidProc, finish };
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

test("a teammate whose report reached its lead is removed after the grace period, and the lead is told", async () => {
  const { hub, store, leadProc, kid, finish } = makeHub();
  finish();
  assert.match(said(leadProc), /Pax\(구현자\) 보고/);
  mock.timers.tick(119_000);
  assert.ok(store.data.sessions.K, "still there inside the grace period");
  mock.timers.tick(1_000);
  await flush();
  assert.equal(store.data.sessions.K, undefined, "removed");
  assert.equal(kid.status, "done");
  // The lead is running (the report started its turn), so the notice goes in mid-turn.
  assert.match(said(leadProc), /Pax\(구현자\) 세션을 정리했어요\(브랜치 dispatch\/impl-1\)\./);
});

test("an idle lead is not woken for the notice: it rides on the lead's next message", async () => {
  const { hub, store, lead, leadProc, finish } = makeHub({ autoRemoveGraceSec: 30 });
  finish();
  hub.touch(lead, { status: "idle" });
  const before = leadProc.lines.length;
  mock.timers.tick(30_000);
  await flush();
  assert.equal(store.data.sessions.K, undefined);
  assert.equal(leadProc.lines.length, before, "no extra turn");
  hub.send("L", "사용자 메시지");
  assert.match(leadProc.lines.at(-1).message.content, /사용자 메시지\n\n\[Dispatch\] Pax\(구현자\) 세션을 정리했어요/);
  hub.touch(lead, { status: "idle" });
  hub.send("L", "또");
  assert.doesNotMatch(leadProc.lines.at(-1).message.content, /정리했어요/, "only once");
});

test("a message to the teammate, a new turn or a permission request cancels the timer", async () => {
  const { hub, store, kid, finish } = makeHub();
  finish();
  mock.timers.tick(60_000);
  hub.send("K", "하나 더 고쳐 줘");
  mock.timers.tick(200_000);
  await flush();
  assert.ok(store.data.sessions.K, "kept: the lead wrote to it");

  // Its next report re-arms; a permission request then cancels.
  finish();
  hub.touch(kid, { status: "waiting" });
  mock.timers.tick(200_000);
  await flush();
  assert.ok(store.data.sessions.K, "kept: waiting on a permission");

  // The next turn's report re-arms, and the full grace counts from there.
  finish();
  mock.timers.tick(119_000);
  await flush();
  assert.ok(store.data.sessions.K);
  mock.timers.tick(1_000);
  await flush();
  assert.equal(store.data.sessions.K, undefined);
});

test("a pending permission or a question to the user keeps the teammate", async () => {
  const { hub, store, kid, finish } = makeHub();
  hub.rt("K").perms.set("r1", { requestId: "r1", tool: "Bash" });
  finish();
  mock.timers.tick(500_000);
  await flush();
  assert.ok(store.data.sessions.K, "permission pending");
  hub.rt("K").perms.clear();
  finish(kid, "어느 쪽으로 할까요?");
  assert.equal(kid.asksUser, true);
  mock.timers.tick(500_000);
  await flush();
  assert.ok(store.data.sessions.K, "asked a question");
});

test("an errored teammate is kept and its lead is told at once", async () => {
  const { hub, store, kid, lead, leadProc } = makeHub();
  hub.touch(kid, { status: "running" });
  hub.touch(lead, { status: "idle" });
  hub.touch(kid, { status: "error", error: "exit 1" });
  assert.match(said(leadProc), /Pax\(구현자\) 세션이 오류로 멈췄어요\(브랜치 dispatch\/impl-1\): exit 1[\s\S]*자동 정리하지 않았어요/);
  mock.timers.tick(500_000);
  await flush();
  assert.ok(store.data.sessions.K);
  assert.equal(await hub.autoRemove("K"), false);
});

test("a lead is never auto-removed, even one attached under another lead", async () => {
  const { hub, store, finish } = makeHub();
  const sub = store.data.sessions.S = { id: "S", name: "Gil", roleName: "관리자", canSpawn: true, parent: "L", provider: "claude", status: "idle", usage: {}, turns: 1 };
  hub.rt("S").proc = fakeProc();
  finish(sub);
  mock.timers.tick(500_000);
  await flush();
  assert.ok(store.data.sessions.S);
  assert.ok(store.data.sessions.L);
});

test("an undelivered report keeps the timer off until it reaches the lead", async () => {
  const { hub, store, lead, finish } = makeHub();
  lead.status = "done"; // no lead to hear it
  finish();
  mock.timers.tick(500_000);
  await flush();
  assert.ok(store.data.sessions.K);
});

test("autoRemoveDone off: nothing is removed and errors are not announced", async () => {
  const { hub, store, kid, leadProc, finish } = makeHub({ autoRemoveDone: false });
  finish();
  mock.timers.tick(500_000);
  await flush();
  assert.ok(store.data.sessions.K);
  const n = leadProc.lines.length;
  hub.touch(kid, { status: "error", error: "x" });
  assert.equal(leadProc.lines.length, n);
});

test("a worktree with uncommitted changes is kept and the lead is told; a clean one goes", async () => {
  mock.timers.reset(); // real git, real timers
  const root = mkdtempSync(join(tmpdir(), "dispatch-ar-git-"));
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "pipe" });
  git("init", "-q"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  const dirty = join(root, "wt-dirty"), clean = join(root, "wt-clean");
  git("worktree", "add", "-q", "-b", "b-dirty", dirty);
  git("worktree", "add", "-q", "-b", "b-clean", clean);
  writeFileSync(join(dirty, "wip.txt"), "unsaved");

  const { hub, store, lead, leadProc, kid } = makeHub({}, root);
  hub.dropDelayMs = 0;
  lead.status = "running"; // mid-turn, so the notice goes in at once
  Object.assign(kid, { worktree: true, cwd: dirty, branch: "b-dirty" });
  assert.equal(await hub.autoRemove("K"), true);
  assert.equal(store.data.sessions.K, undefined);
  assert.ok(existsSync(dirty), "dirty worktree kept");
  assert.match(said(leadProc), /세션을 정리했어요\(브랜치 b-dirty\)\. 커밋 안 된 변경이 있어 작업 폴더 .*wt-dirty는 남겼어요/);

  store.data.sessions.C = { id: "C", name: "Ari", roleName: "리뷰어", parent: "L", provider: "claude", status: "idle", usage: {}, worktree: true, cwd: clean, branch: "b-clean" };
  assert.equal(await hub.autoRemove("C"), true);
  assert.ok(!existsSync(clean), "clean worktree removed");
  assert.doesNotMatch(said(leadProc).split("---").at(-1), /남겼어요/);
  assert.match(git("branch", "--list", "b-clean").toString(), /b-clean/, "branch stays");
});

test("settings: autoRemoveDone defaults on, grace defaults to 120 s and is range-checked", () => {
  const store = { data: { settings: {} } };
  const t = teamSettings(store);
  assert.equal(t.autoRemoveDone, true);
  assert.equal(t.autoRemoveGraceSec, 120);
  const next = patchTeam(store, { autoRemoveDone: false, autoRemoveGraceSec: 45 }, { roles: [], models: [] });
  assert.equal(next.autoRemoveDone, false);
  assert.equal(next.autoRemoveGraceSec, 45);
  assert.throws(() => patchTeam(store, { autoRemoveGraceSec: 5 }, { roles: [], models: [] }), /10~3600/);
  assert.throws(() => patchTeam(store, { autoRemoveGraceSec: 4000 }, { roles: [], models: [] }), /10~3600/);
});
