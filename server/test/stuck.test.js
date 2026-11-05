import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../sessions.js";
import { TEAM_DEFAULTS, patchTeam } from "../settings.js";
import { checkKey, exitUnclear, normalizeCommand, recordCheck, sessionStuck, stuckSig, taskStuck } from "../state.js";

const cfg = TEAM_DEFAULTS();
const MIN = 60_000;

test("normalizeCommand keeps cd, drops env, redirections and output filters", () => {
  const want = "cd web && npx playwright test e2e/a.spec.ts";
  assert.equal(normalizeCommand("cd web && npx playwright test e2e/a.spec.ts 2>&1 | tail -20"), want);
  assert.equal(normalizeCommand("bash -lc 'cd web && CI=1 npx playwright test e2e/a.spec.ts'"), want);
  assert.equal(normalizeCommand("  npx   playwright test  e2e/a.spec.ts > /dev/null"), "npx playwright test e2e/a.spec.ts");
});

test("checkKey: only checks get a key; same command, same key; another cwd, another key", () => {
  const k = checkKey("npm test 2>&1 > /tmp/out");
  assert.match(k, /^[0-9a-f]{12}$/);
  assert.equal(checkKey("npm   test"), k);
  assert.notEqual(checkKey("cd web && npm test"), k);
  assert.notEqual(checkKey("cd web && npm test"), checkKey("cd server && npm test"));
  assert.notEqual(checkKey("npm run build"), k);
  assert.equal(checkKey("ls -la"), null);
  assert.equal(checkKey("git status"), null);
  assert.equal(checkKey(""), null);
});

test("checkKey: a pipe or || hides the exit code, so the command can't be judged", () => {
  for (const c of ["npm test 2>&1 | tail -20", "bash -lc 'cd web && npm test | tee out'", "npm test |& tail", "npm test || true"]) {
    assert.equal(exitUnclear(c), true, c);
    assert.equal(checkKey(c), null, c);
  }
  assert.equal(exitUnclear("set -o pipefail; npm test | tail -5"), false);
  assert.equal(checkKey("set -o pipefail; npm test | tail -5"), checkKey("npm test"));
  assert.equal(exitUnclear(`grep "a|b" x && npm test`), false);
});

test("recordCheck counts consecutive failures per key; a pass resets", () => {
  const fails = new Map();
  recordCheck(fails, "a", false, 1, "e2e 실행");
  recordCheck(fails, "b", false, 2);
  recordCheck(fails, "a", false, 3);
  assert.equal(fails.get("a").count, 2);
  assert.equal(fails.get("a").firstAt, 1);
  assert.equal(recordCheck(fails, "a", true, 4), null);
  assert.equal(fails.has("a"), false);
  assert.equal(fails.get("b").count, 1);
});

test("recordCheck: a pass clears every failing key of the same kind", () => {
  const fails = new Map();
  for (let i = 0; i < 3; i++) recordCheck(fails, "suite", false, i, "단위 테스트");
  recordCheck(fails, "build", false, 5, "빌드");
  recordCheck(fails, "one-spec", true, 6, "단위 테스트");
  assert.equal(fails.has("suite"), false);
  assert.equal(fails.get("build").count, 1);
});

test("sessionStuck: repeat-fail at the threshold, silent after N quiet minutes", () => {
  const fails = new Map();
  for (let i = 0; i < 2; i++) recordCheck(fails, "k", false, 100 + i, "e2e 실행");
  assert.equal(sessionStuck({ status: "running" }, { fails, lastEventAt: 0 }, 1000, cfg), null);
  recordCheck(fails, "k", false, 200, "e2e 실행");
  const st = sessionStuck({ status: "idle" }, { fails, lastEventAt: 0 }, 1000, cfg);
  assert.deepEqual(st, { reason: "repeat-fail", label: "e2e가 3번 연속 실패했어요", count: 3, key: "k", kind: "e2e 실행", sinceMs: 100 });
  assert.equal(sessionStuck({ status: "idle" }, { fails }, 1000, { ...cfg, stuckFails: 0 }), null);
  assert.equal(sessionStuck({ status: "done" }, { fails }, 1000, cfg), null);

  const quiet = { fails: new Map(), lastEventAt: 0 };
  assert.equal(sessionStuck({ status: "running" }, quiet, 9 * MIN, cfg), null);
  assert.deepEqual(sessionStuck({ status: "running" }, quiet, 10 * MIN, cfg), { reason: "silent", label: "10분 넘게 출력이 없어요", sinceMs: 0 });
  assert.equal(sessionStuck({ status: "idle" }, quiet, 60 * MIN, cfg), null);
  assert.equal(sessionStuck({ status: "waiting" }, quiet, 60 * MIN, cfg), null);
});

test("taskStuck: over-eta at 1.5× the stage eta", () => {
  const t = { stage: "impl", createdAt: 0, stageAt: 0, etaSetAt: 0, etaAt: 20 * MIN };
  assert.equal(taskStuck(t, null, null, 29 * MIN, cfg), null);
  assert.deepEqual(taskStuck(t, null, null, 30 * MIN, cfg),
    { reason: "over-eta", label: "예상 20분의 1.5배를 넘겼어요", stage: "impl", etaMinutes: 20, sinceMs: 30 * MIN });
  assert.equal(taskStuck({ ...t, stage: "done" }, null, null, 99 * MIN, cfg), null);
  assert.equal(taskStuck({ ...t, etaAt: null }, null, null, 99 * MIN, cfg), null);
});

test("taskStuck: board says 구현 while the owner loops on e2e", () => {
  const owner = { stuck: { reason: "repeat-fail", kind: "e2e 실행", count: 4, key: "k", sinceMs: 5 } };
  const st = taskStuck({ stage: "impl" }, owner, null, 10, cfg);
  assert.equal(st.reason, "stage-mismatch");
  assert.equal(st.label, "보드는 구현인데 실제로는 e2e 실패가 반복돼요");
  assert.equal(st.count, 4);
  assert.equal(taskStuck({ stage: "test" }, owner, null, 10, cfg), null);
  assert.equal(taskStuck({ stage: "impl" }, owner, null, 10, { ...cfg, stuckMismatchMinutes: 0 }), null, "0 turns both mismatch paths off");
  // A long test run during 구현, no failures needed.
  const act = { label: "단위 테스트", since: 0 };
  assert.equal(taskStuck({ stage: "plan" }, null, act, 9 * MIN, cfg), null);
  assert.equal(taskStuck({ stage: "plan" }, null, act, 10 * MIN, cfg).label, "보드는 계획인데 10분 넘게 단위 테스트 중이에요");
});

test("stuckSig ignores the count, so a growing loop is one event", () => {
  const a = { reason: "repeat-fail", key: "k", count: 3 };
  assert.equal(stuckSig(a), stuckSig({ ...a, count: 7 }));
  assert.notEqual(stuckSig(a), stuckSig({ ...a, key: "j" }));
  assert.equal(stuckSig(null), "");
});

test("settings: stuck thresholds have defaults and are validated", () => {
  const store = { data: { settings: {} } };
  assert.equal(TEAM_DEFAULTS().stuckFails, 3);
  const next = patchTeam(store, { stuckFails: 5, stuckSilentMinutes: 0, stuckEtaRatio: 2 }, { roles: [], models: [] });
  assert.equal(next.stuckFails, 5);
  assert.equal(next.stuckSilentMinutes, 0);
  assert.equal(next.stuckEtaRatio, 2);
  assert.throws(() => patchTeam(store, { stuckEtaRatio: 0.5 }, { roles: [], models: [] }));
  assert.throws(() => patchTeam(store, { stuckFails: -1 }, { roles: [], models: [] }));
});

/* ---- Hub wiring ---- */

function fakeHub(sessions) {
  const dir = mkdtempSync(path.join(tmpdir(), "dispatch-stuck-"));
  const events = [];
  const hub = Object.assign(Object.create(Hub.prototype), {
    live: new Map(), tdir: dir,
    store: { data: { sessions: Object.fromEntries(sessions.map(s => [s.id, s])), settings: {}, tasks: {} }, save() {}, addDaily() {} },
  });
  hub.emit = (ev, d) => { events.push([ev, d]); return true; };
  return { hub, events, dir };
}

const session = (over = {}) => ({ id: "a", name: "Juno", status: "running", parent: "lead", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, turns: 0, updatedAt: 0, ...over });

function claudeRun(hub, s, i, ok) {
  hub.onClaude(s, { type: "assistant", message: { content: [{ type: "tool_use", id: `t${i}`, name: "Bash", input: { command: "cd web && npx playwright test e2e/x.spec.ts" } }] } });
  hub.onClaude(s, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "secret output", is_error: !ok }] } });
}

test("Claude: three failures of the same e2e flag the session once; a pass clears it", () => {
  const s = session();
  const { hub } = fakeHub([s]);
  const marks = [];
  const mark = hub.mark.bind(hub);
  hub.mark = (x, patch) => { if ("stuck" in patch) marks.push(patch.stuck?.reason ?? null); mark(x, patch); };
  claudeRun(hub, s, 1, false);
  claudeRun(hub, s, 2, false);
  assert.equal(s.stuck ?? null, null);
  claudeRun(hub, s, 3, false);
  assert.equal(s.stuck.reason, "repeat-fail");
  assert.equal(s.stuck.count, 3);
  assert.equal(hub.publicSession(s).state, "stuck");
  assert.equal(hub.publicSession(s).attention.reason, "e2e가 3번 연속 실패했어요");
  claudeRun(hub, s, 4, false);
  assert.equal(s.stuck.count, 4);
  assert.equal(s.stuck.label, "e2e가 4번 연속 실패했어요");
  assert.deepEqual(marks, ["repeat-fail"], "the fourth failure updates in place, no second flag event");
  claudeRun(hub, s, 5, true);
  assert.equal(s.stuck, null);
  assert.deepEqual(marks, ["repeat-fail", null]);
  // Only the hash and counts are kept on the session, never the command or its output.
  assert.doesNotMatch(JSON.stringify(s), /playwright|secret/);
});

test("Codex: exit codes drive the same counter", () => {
  const s = session({ provider: "codex" });
  const { hub } = fakeHub([s]);
  const run = code => hub.onCodex(s, { type: "item.completed", item: { type: "command_execution", command: "bash -lc 'npm test'", aggregated_output: "x", exit_code: code } });
  run(1); run(1); run(1);
  assert.equal(s.stuck.reason, "repeat-fail");
  assert.equal(s.stuck.label, "테스트가 3번 연속 실패했어요");
  run(0);
  assert.equal(s.stuck, null);
});

test("a piped check leaves the count alone instead of passing it", () => {
  const s = session({ provider: "codex" });
  const { hub } = fakeHub([s]);
  const run = (command, code) => hub.onCodex(s, { type: "item.completed", item: { type: "command_execution", command, aggregated_output: "x", exit_code: code } });
  run("npm test", 1); run("npm test", 1);
  run("npm test 2>&1 | tail -20", 0); // tail's 0, not npm's
  run("npm test", 1);
  assert.equal(s.stuck?.reason, "repeat-fail");
  assert.equal(s.stuck.count, 3);
  // Claude: the Bash tool result of a piped command is ignored too.
  const c = session({ id: "b" });
  const h2 = fakeHub([c]).hub;
  const bash = (i, command, ok) => {
    h2.onClaude(c, { type: "assistant", message: { content: [{ type: "tool_use", id: `p${i}`, name: "Bash", input: { command } }] } });
    h2.onClaude(c, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `p${i}`, content: "", is_error: !ok }] } });
  };
  bash(1, "npm test", false); bash(2, "npm test", false);
  bash(3, "npm test | tail -5", true);
  bash(4, "npm test", false);
  assert.equal(c.stuck?.count, 3);
});

test("a pass of the same kind under another command clears the flag", () => {
  const s = session({ provider: "codex" });
  const { hub } = fakeHub([s]);
  const run = (command, code) => hub.onCodex(s, { type: "item.completed", item: { type: "command_execution", command, aggregated_output: "x", exit_code: code } });
  run("npm test", 1); run("npm test", 1); run("npm test", 1);
  assert.equal(s.stuck.reason, "repeat-fail");
  run("npx vitest run src/a.test.ts", 0);
  assert.equal(s.stuck, null);
});

test("checkTeams: silent session flagged once, cleared by the next event", () => {
  const s = session();
  const { hub, events } = fakeHub([s]);
  hub.rt(s.id).lastEventAt = 0;
  hub.checkTeams(11 * MIN);
  assert.equal(s.stuck.reason, "silent");
  const n = events.filter(([ev]) => ev === "session").length;
  hub.checkTeams(12 * MIN);
  assert.equal(events.filter(([ev]) => ev === "session").length, n, "same reason, no new event");
  hub.push(s, { kind: "assistant", text: "다시 시작" });
  assert.equal(s.stuck, null);
});

test("tasks: over-eta and stage mismatch land on the task JSON", async () => {
  const lead = session({ id: "lead", name: "Faye", parent: null, canSpawn: true, status: "idle" });
  const s = session();
  const { hub } = fakeHub([lead, s]);
  const t = await hub.setTask("lead", { title: "배지", stage: "impl", owner: "Juno", eta_minutes: 20 });
  assert.equal(t.stuck, null);
  hub.checkTaskStuck(t.etaSetAt + 31 * MIN);
  assert.equal(t.stuck.reason, "over-eta");
  for (let i = 0; i < 3; i++) claudeRun(hub, s, i, false);
  hub.checkTaskStuck(t.etaSetAt + 32 * MIN);
  assert.equal(t.stuck.reason, "stage-mismatch");
  assert.equal(hub.tasks[0].stuck.label, "보드는 구현인데 실제로는 e2e 실패가 반복돼요");
  await hub.setTask("lead", { id: t.id, stage: "test" });
  assert.notEqual(t.stuck?.reason, "stage-mismatch");
});

test("nothing about the command text reaches the transcript-free state", () => {
  const s = session();
  const { hub, dir } = fakeHub([s]);
  for (let i = 0; i < 3; i++) claudeRun(hub, s, i, false);
  assert.ok(readdirSync(dir).length >= 1); // transcripts are the only place the command lives
  assert.match(readFileSync(path.join(dir, "a.jsonl"), "utf8"), /playwright/);
  assert.doesNotMatch(JSON.stringify(hub.store.data), /playwright|secret output/);
});
