// Work lanes (#768): quickfix skips the plan gate and the reviewer; past runs give an ETA hint. No CLI starts.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";
import { staticModels } from "../../server/dispatch/models.js";
import { ROLES } from "../../server/dispatch/roles.js";
import { resolveProfile } from "../../server/dispatch/mode-profiles.js";
import { etaHint, laneItems, recordRunTime } from "../../server/dispatch/lanes.js";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const MODELS = staticModels();

async function makeHub() {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-768-lanes-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")) });
  hub.isConnected = p => p === "claude";
  hub.start = () => {};
  hub.resolveProfile = async (mode, role, o = {}) => resolveProfile({ mode, role, models: MODELS, isConnected: hub.isConnected, perm: o.perm });
  return hub;
}

test("laneItems: quickfix refuses reviewer and tester, defaults to the quickfix mode; unknown lane is a 400", () => {
  assert.deepEqual(laneItems([{ role: "impl" }], undefined), [{ role: "impl" }]);
  assert.deepEqual(laneItems([{ role: "impl" }], "quickfix"), [{ role: "impl", lane: "quickfix", mode: "quickfix" }]);
  assert.deepEqual(laneItems([{ role: "impl", mode: "impl" }], "quickfix"), [{ role: "impl", mode: "impl", lane: "quickfix" }]);
  assert.deepEqual(laneItems([{ role: "review" }], "normal"), [{ role: "review", lane: "normal" }]);
  assert.throws(() => laneItems([{ role: "impl" }, { role: "review" }], "quickfix"), e => e.status === 400);
  assert.throws(() => laneItems([{ role: "impl" }], "fast"), e => e.status === 400);
});

test("laneItems: quickfix is exactly one impl, design or docs session", () => {
  for (const role of ["impl", "design", "docs"]) assert.equal(laneItems([{ role }], "quickfix")[0].lane, "quickfix");
  assert.equal(laneItems([{ role: "impl", n: 1 }], "quickfix").length, 1);
  for (const role of ["lead", "review", "test"]) assert.throws(() => laneItems([{ role }], "quickfix"), e => e.status === 400, role);
  assert.throws(() => laneItems([{ role: "impl", n: 2 }], "quickfix"), e => e.status === 400 && /세션 하나/.test(e.message));
  assert.throws(() => laneItems([{ role: "impl" }, { role: "docs" }], "quickfix"), e => e.status === 400 && /2개/.test(e.message));
});

test("create: a quickfix passes a waiting plan gate and runs Opus 5.5; normal is still gated", async () => {
  const hub = await makeHub();
  const [lead] = await hub.create({ items: [{ role: "lead" }], commonPrompt: "hi", worktree: false });
  hub.createGate = () => "계획 승인 전이에요";
  await assert.rejects(hub.create({ items: [{ role: "impl" }], commonPrompt: "x", worktree: false, parent: lead.id, lane: "normal" }), /계획 승인 전/);
  const [q] = await hub.create({ items: [{ role: "impl" }], commonPrompt: "x", worktree: false, parent: lead.id, lane: "quickfix" });
  assert.equal(q.lane, "quickfix");
  assert.equal(q.mode, "quickfix");
  assert.equal(q.model, "claude-opus-5-5");
  await assert.rejects(hub.create({ items: [{ role: "review" }], commonPrompt: "x", worktree: false, parent: lead.id, lane: "quickfix" }), e => e.status === 400);
});

test("run times: merged tasks feed a per-lane median; capped; none yet is null", async () => {
  assert.equal(etaHint([], "quickfix"), null);
  let list = [];
  for (const m of [6, 9, 7]) list = recordRunTime(list, { lane: "quickfix", minutes: m });
  list = recordRunTime(list, { lane: "normal", minutes: 40 });
  assert.deepEqual(etaHint(list, "quickfix"), { lane: "quickfix", runs: 3, median: 7, max: 9 });
  assert.deepEqual(etaHint(list), { lane: "normal", runs: 1, median: 40, max: 40 });
  for (let i = 0; i < 100; i++) list = recordRunTime(list, { lane: "normal", minutes: 1 });
  assert.equal(list.length, 60);

  const hub = await makeHub();
  const [lead] = await hub.create({ items: [{ role: "lead" }], commonPrompt: "hi", worktree: false });
  const t = await hub.setTask(lead.id, { title: "토스트 위치", lane: "quickfix" });
  assert.equal(t.lane, "quickfix");
  t.mergeCheck = null;
  // Closed without a commit (abandoned): not a run.
  await hub.setTask(lead.id, { id: t.id, stage: "done" });
  assert.equal(hub.etaHint("quickfix"), null);
});

test("agent prompts call the tool Atelier, carry the lanes and the merge hand-off, and drop emphasis", async () => {
  const { ROLES: roles, SPAWN_PROMPT, CHILD_PROMPT } = await import("../../server/dispatch/roles.js");
  const all = [SPAWN_PROMPT, CHILD_PROMPT, ...roles.map(r => r.prompt)].join("\n");
  assert.doesNotMatch(all, /Dispatch|Drawing|IMPORTANT|NEVER|반드시/);
  assert.match(SPAWN_PROMPT, /아틀리에\(Atelier\)/);
  for (const lane of ["quickfix", "normal", "risky"]) assert.match(SPAWN_PROMPT, new RegExp(`- ${lane}:`));
  // The merge steps moved to the merge role (#1031); the lead hands PRs and merges off.
  const merge = roles.find(r => r.id === "merge").prompt;
  assert.match(merge, /gh pr merge <번호> --merge/);
  assert.match(merge, /git merge --ff-only origin\/develop/);
  assert.match(SPAWN_PROMPT, /머지 담당\(merge\)/);
  assert.match(SPAWN_PROMPT, /normal·risky에서만 modern-web-guidance/);
  assert.doesNotMatch(SPAWN_PROMPT, /20분/);
  // Plans, documents and diagrams are gone: no plan tools or document areas in the prompts.
  assert.doesNotMatch(all, /write_plan|note_step|\[영역\]|dpx\.json/);
  assert.doesNotMatch(all, /pipelines/);
  assert.match(SPAWN_PROMPT, /리뷰어는 늘 새 세션이고 작성자가 아니다/);
  for (const p of [SPAWN_PROMPT, CHILD_PROMPT]) {
    assert.match(p, /전체 e2e는 돌리지 않는다/);
    assert.match(p, /실제 실행 출력/);
    assert.match(p, /\[개인정보\]/);
  }
});

test("implementer and designer prompts carry the UI library rules (#764)", async () => {
  const { ROLES: roles } = await import("../../server/dispatch/roles.js");
  for (const id of ["impl", "design"]) {
    const p = roles.find(r => r.id === id).prompt;
    for (const lib of ["Sonner", "Vaul", "cmdk", "NumberFlow"]) assert.match(p, new RegExp(lib));
    assert.match(p, /화면마다 눈에 띄는 요소는 하나/);
    assert.match(p, /PR에 제안한다/);
    assert.match(p, /docs\/design\/ui-libraries\.md/);
    assert.doesNotMatch(p, /꼭/);
  }
  for (const id of ["lead", "review", "test", "docs"]) assert.doesNotMatch(roles.find(r => r.id === id).prompt, /Sonner/);
});

test("role prompts point at no removed Eraser reference docs (#1070)", async () => {
  const { ROLES: roles } = await import("../../server/dispatch/roles.js");
  for (const r of roles) {
    assert.doesNotMatch(r.prompt, /\[Eraser 기준\]/);
    assert.doesNotMatch(r.prompt, /docs\/research\/eraser/);
  }
});

test("docs role and lead prompt carry the writing style; other roles do not (#737)", async () => {
  const { ROLES: roles, SPAWN_PROMPT, CHILD_PROMPT } = await import("../../server/dispatch/roles.js");
  for (const p of [roles.find(r => r.id === "docs").prompt, SPAWN_PROMPT]) {
    assert.match(p, /\[글쓰기\]/);
    assert.match(p, /다음 행동/);
    assert.match(p, /번호 목록/);
    assert.match(p, /끝난 것과 남은 것/);
    assert.match(p, /docs\/design\/writing-style\.md/);
  }
  for (const id of ["impl", "review", "test", "design"]) assert.doesNotMatch(roles.find(r => r.id === id).prompt, /\[글쓰기\]/);
  assert.doesNotMatch(CHILD_PROMPT, /\[글쓰기\]/);
});

test("lead and teammate prompts carry the one-question-per-turn rule (#1050)", async () => {
  const { SPAWN_PROMPT, CHILD_PROMPT } = await import("../../server/dispatch/roles.js");
  for (const p of [SPAWN_PROMPT, CHILD_PROMPT]) {
    assert.match(p, /\[질문\]/);
    assert.match(p, /AskUserQuestion/);
    assert.match(p, /questions\[\]/);
    assert.match(p, /한 턴에 질문 하나/);
    assert.match(p, /질문 1\/4: …\?/);
    assert.match(p, /\(추천\)/);
    assert.match(p, /라벨 — 이유 한 줄/);
    assert.match(p, /턴의 마지막/);
  }
});
