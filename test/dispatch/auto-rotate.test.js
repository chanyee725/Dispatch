// #969: a session past `handoffMTokens` is swapped for a fresh one with the same settings between turns, on a real Hub
// in a scratch git repo with the fake claude (test/fixtures/fake-cli/). No real agent CLI is started.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { patchTeam, teamSettings } from "../../server/dispatch/settings.js";
import { fakeCliBin, fakeSpawner, until } from "../fixtures/fake-cli/index.mjs";

const MODELS = [{ id: "claude-fable-5-2", provider: "claude", efforts: ["low"], contextWindow: 200000 }];
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const fakeProc = () => { const lines = []; return { lines, stdin: { write: l => lines.push(JSON.parse(l)) }, kill() {} }; };
/** 2M tokens processed: past a 1M guard. */
const LONG = () => ({ input: 1_500_000, output: 100_000, cacheRead: 400_000, cacheWrite: 0 });

function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), "drawing-rot-"));
  dirs.push(root);
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(root, "README.md"), "scratch\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  return root;
}

function makeHub(team = {}) {
  const root = scratchRepo();
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const store = {
    data: { seq: 2, sessions: {}, tasks: {}, tickets: {}, pipelines: {}, settings: { guard: { enabled: false }, team: { handoffMTokens: 1, ...team } } },
    save() {}, addDaily() {},
  };
  const hub = new Hub({ root, store, models: MODELS, roles: [], port: 0, limits: Object.assign(new EventEmitter(), { claude: {} }), spawnCli: fakeSpawner(bin) });
  after(() => hub.stopAll());
  const base = { provider: "claude", model: "claude-fable-5-2", modelLabel: "Fable", effort: "low", perm: "auto", status: "idle", turns: 40, last: "", worktree: false, branch: null };
  const lead = store.data.sessions.L = { ...base, id: "L", n: 1, name: "Jae", role: "lead", roleName: "관리자", canSpawn: true, parent: null, cwd: root, prompt: "lead prompt", usage: LONG() };
  const kid = store.data.sessions.K = { ...base, id: "K", n: 2, name: "Pax", role: "impl", roleName: "구현자", canSpawn: false, parent: "L", cwd: root, branch: "feat/x", prompt: "impl prompt", last: "테스트 통과", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } };
  const kidProc = fakeProc();
  hub.rt("K").proc = kidProc;
  return { hub, store, root, bin, lead, kid, kidProc };
}

const fresh = (store, old) => Object.values(store.data.sessions).find(s => s.rotatedFrom?.id === old);
const handoff = (hub, id) => hub.transcript(id).find(e => e.kind === "user" && e.label === "인계")?.text ?? "";

test("a lead past the guard is swapped at the end of its turn: teammates, board, tickets and plans move, the handoff goes first", async () => {
  const { hub, store, root, bin, lead } = makeHub();
  store.data.tasks.T1 = { id: "T1", lead: "L", title: "구현", stage: "doing", updatedAt: Date.now() };
  store.data.tickets.X1 = { id: "X1", lead: "L" };
  store.data.pipelines.P1 = { id: "P1", lead: "L" };
  hub.rt("L").lastText = "인계: Pax가 feat/x에서 구현 중, 다음은 리뷰";
  hub.endTurn(lead);

  const s = fresh(store, "L");
  assert.ok(s, "a new session was made");
  assert.equal(store.data.sessions.L, undefined, "the old lead is removed");
  assert.notEqual(s.name, "Jae");
  for (const k of ["role", "provider", "model", "effort", "perm", "cwd", "branch", "canSpawn", "prompt"]) assert.equal(s[k], lead[k], k);
  assert.equal(s.parent, null);
  assert.deepEqual({ name: s.rotatedFrom.name, mtok: s.rotatedFrom.mtok }, { name: "Jae", mtok: 2 });

  assert.equal(store.data.sessions.K.parent, s.id, "teammate follows the lead");
  assert.equal(store.data.tasks.T1?.lead, s.id, "board task kept and moved");
  assert.equal(store.data.tickets.X1?.lead, s.id);
  assert.equal(store.data.pipelines.P1.lead, s.id);

  const note = handoff(hub, s.id);
  assert.match(note, /이전 세션 Jae이\(가\) 누적 2M 토큰을 넘어/);
  assert.match(note, /\[직전 응답\]\n인계: Pax가 feat\/x에서 구현 중/);
  assert.match(note, /\[팀원\]\n- Pax \(구현자, id K/);
  assert.ok(hub.transcript(s.id).some(e => e.kind === "info" && e.text.startsWith(`누적 2M 토큰이라 새 세션 ${s.name}로 바꿨어요`)));

  // The fake claude ran in the same work folder.
  await until(() => bin.calls().some(c => c.bin === "claude" && c.cwd === root));
});

test("a teammate past the guard whose lead was told is swapped with the lead's next message, and the lead learns the new id", () => {
  const { hub, store, kid } = makeHub();
  kid.usage = LONG();
  kid.longRun = { mtok: 2, sinceMs: 0, noticed: true, told: true };
  hub.rt("L").proc = fakeProc();
  hub.send("K", "리뷰 반영해 줘");

  const s = fresh(store, "K");
  assert.ok(s);
  assert.equal(store.data.sessions.K, undefined);
  assert.equal(s.parent, "L");
  assert.equal(s.branch, "feat/x");
  assert.match(handoff(hub, s.id), /\[이어서 할 일\]\n리뷰 반영해 줘/);
  const told = [...(hub.rt("L").leadNotes || [])].join("\n");
  assert.match(told, new RegExp(`Pax\\(구현자\\) 세션이 누적 2M 토큰을 넘어 같은 설정의 새 팀원 ${s.name}\\(id ${s.id}\\)로 바꿨어요\\(브랜치 feat/x\\)`));
});

test("a teammate whose lead was not told yet keeps its session", () => {
  const { hub, store, kid, kidProc } = makeHub();
  kid.usage = LONG();
  hub.send("K", "계속");
  assert.ok(store.data.sessions.K);
  assert.equal(fresh(store, "K"), undefined);
  assert.equal(kidProc.lines.at(-1).message.content, "계속");
});

test("with 오래 쓴 세션 자동 교체 off, a long lead stays", () => {
  const { hub, store, lead } = makeHub({ autoRotateLong: false });
  hub.rt("L").lastText = "인계";
  hub.endTurn(lead);
  assert.ok(store.data.sessions.L);
  assert.equal(fresh(store, "L"), undefined);
});

test("patchTeam saves autoRotateLong; it is on by default", () => {
  const store = { data: { settings: {} } };
  assert.equal(teamSettings(store).autoRotateLong, true);
  patchTeam(store, { autoRotateLong: false }, { roles: [], models: MODELS });
  assert.equal(teamSettings(store).autoRotateLong, false);
  patchTeam(store, { autoRotateLong: true }, { roles: [], models: MODELS });
  assert.equal(teamSettings(store).autoRotateLong, true);
});
