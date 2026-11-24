// The server closes board tasks whose work already landed (#930): commit on develop, a merged PR tied to the
// task, or a closed issue it names. Scratch git repo (one commit) and the fake gh only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Hub } from "../../server/dispatch/hub.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";
import { createIssueList } from "../../server/dispatch/issues.js";
import { closeEvidence, taskIssue } from "../../server/dispatch/task-close.js";
import { FAKE_MARKER } from "../../server/dispatch/cli.js";
import { attentionItems } from "../../shared/dispatch/attention.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = p => { const d = mkdtempSync(path.join(tmpdir(), p)); dirs.push(d); return d; };

function scratchRepo() {
  const dir = tmp("drawing-autoclose-");
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
  g("init", "-q", "-b", "develop");
  g("config", "user.name", "Test"); g("config", "user.email", "test@example.invalid");
  writeFileSync(path.join(dir, "a.txt"), "a\n"); g("add", "."); g("commit", "-qm", "init");
  const head = g("rev-parse", "HEAD");
  g("checkout", "-qb", "feat/903-open");
  writeFileSync(path.join(dir, "b.txt"), "b\n"); g("add", "."); g("commit", "-qm", "wip");
  g("checkout", "-q", "develop");
  // Branched off develop, nothing committed: an ancestor of develop, but no finished work.
  g("branch", "feat/904-fresh");
  // Committed and merged into develop: finished work.
  g("checkout", "-qb", "feat/905-done");
  writeFileSync(path.join(dir, "c.txt"), "c\n"); g("add", "."); g("commit", "-qm", "done");
  g("checkout", "-q", "develop"); g("merge", "-q", "--no-ff", "-m", "merge 905", "feat/905-done");
  return { dir, head };
}

function fakeGh(scenario) {
  const bin = tmp("drawing-autoclose-gh-");
  const file = path.join(bin, "gh");
  writeFileSync(file, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(path.join(HERE, "../fixtures/fake-cli/gh.mjs")).href)});\n`);
  chmodSync(file, 0o755);
  writeFileSync(path.join(bin, FAKE_MARKER), "");
  const sc = path.join(bin, "scenario.json");
  writeFileSync(sc, JSON.stringify(scenario));
  const log = path.join(bin, "calls.jsonl");
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : []);
  return { env: { PATH: `${bin}:${process.env.PATH}`, FAKE_GH_SCENARIO: sc, FAKE_CLI_LOG: log }, calls };
}

async function makeHub(root) {
  const store = new Store(root);
  await store.load();
  store.save = () => {};
  const hub = new Hub({ root, store, models: [], roles: [], port: 0, limits: new SharedLimits(path.join(root, ".limits.json")),
    spawnCli: () => { throw Object.assign(new Error("no CLI in this test"), { code: "ECLIDENIED" }); } });
  return { hub, store };
}

const M = 60_000;
const task = (id, over) => ({ id, lead: null, title: id, stage: "merge", createdAt: 0, stageAt: 0, stages: [{ stage: "merge", at: 0 }],
  owner: null, etaAt: Date.now() - 30 * M, etaSetAt: Date.now() - 60 * M, note: "", updatedAt: Date.now(), ...over });

test("taskIssue: the branch's issue, else a #N that ends the title; mentions elsewhere do not count", () => {
  assert.equal(taskIssue({ title: "E680: board (#930)", commit: "feat/77-x" }), 77);
  assert.equal(taskIssue({ title: "E680: board (#930)" }), 930);
  assert.equal(taskIssue({ title: "fix lint #12" }), 12);
  assert.equal(taskIssue({ title: "E931: #930 후속" }), null);
  // Leads' own titles start with the issue (2026-11-20); a leading "PR #N" is a PR, not an issue.
  assert.equal(taskIssue({ title: "#879 세션 보드 대시보드 카드화" }), 879);
  assert.equal(taskIssue({ title: "PR #907 리뷰 nit 정리" }), null);
  assert.equal(taskIssue({ title: "#12abc 아님" }), null);
  assert.equal(taskIssue({ title: "board (#879 회귀 수정)" }), null);
  assert.equal(taskIssue({ title: "E680: no number", commit: "abc1234" }), null);
  assert.equal(taskIssue({ title: "a&#39;b" }), null);
});

test("closeEvidence: no evidence keeps the task open with a reason", async () => {
  const none = { verify: async () => ({ ok: false, reason: "x 커밋이 아직 develop에 없어요" }), prs: [], issueState: async () => "open" };
  let r = await closeEvidence({ title: "plain" }, none);
  assert.equal(r.ok, false);
  assert.match(r.reason, /커밋과 이슈 번호가 없어/);
  r = await closeEvidence({ title: "thing", stage: "merge", commit: "feat/5-x" }, { ...none, branchState: async () => "merged", prs: null });
  assert.equal(r.ok, false);
  assert.match(r.reason, /아직 develop에 없어요/);
  assert.match(r.reason, /PR 정보를 읽지 못했어요/);
  assert.match(r.reason, /#5에 병합된 PR이나 닫힌 이슈가 없어요/);
  // An open or closed-unmerged PR is no evidence.
  r = await closeEvidence({ title: "#5" }, { ...none, prs: [{ pr: { number: 9, state: "closed" }, issues: new Set([5]) }] });
  assert.equal(r.ok, false);
});

test("closeEvidence does not match other work (#930 review)", async () => {
  const verify = async c => ({ ok: true, commit: "a".repeat(40), base: "develop" });
  const closedIssues = async n => (n === 930 || n === 879 ? "closed" : "open");
  const merged = [{ pr: { number: 930, state: "merged", branch: "feat/12-other" }, issues: new Set([12]) },
    { pr: { number: 940, state: "merged", branch: "feat/930-board" }, issues: new Set([930]) }];
  const opts = { verify, prs: merged, issueState: closedIssues };
  // A title that only mentions other issues: their closed issue or merged PR is not this task's evidence.
  for (const title of ["E931: #930 후속", "board (#879 회귀 수정)", "E931: #930 and #879 follow-up work"]) {
    const r = await closeEvidence({ title, stage: "merge" }, opts);
    assert.equal(r.ok, false, title);
  }
  // Issue #12 is not PR #12, and PR #930 is not issue #930: a task on issue 950 matches neither.
  let r = await closeEvidence({ title: "x (#950)", stage: "merge" }, { ...opts, prs: [{ pr: { number: 950, state: "merged" }, issues: new Set([7]) }] });
  assert.equal(r.ok, false);
  r = await closeEvidence({ title: "x (#12)", stage: "merge" }, { ...opts, prs: [{ pr: { number: 12, state: "merged" }, issues: new Set() }] });
  assert.equal(r.ok, false);
  // The PR closing the task's own issue is evidence.
  r = await closeEvidence({ title: "x (#12)", stage: "merge" }, opts);
  assert.deepEqual([r.ok, r.via, r.pr], [true, "pr", 930]);
  // A fresh branch (no commits) is an ancestor of develop but not finished work, in any stage.
  for (const stage of ["plan", "impl", "merge"]) {
    r = await closeEvidence({ title: "x", stage, commit: "feat/77-fresh" }, { ...opts, prs: [], branchState: async () => "empty" });
    assert.equal(r.ok, false, stage);
    assert.match(r.reason, /feat\/77-fresh 브랜치에 새 커밋이 없어요/);
  }
  // A hash named during plan/impl is not evidence yet; in review it is.
  r = await closeEvidence({ title: "x", stage: "impl", commit: "abc1234" }, { ...opts, prs: [] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /계획·구현 단계라/);
  r = await closeEvidence({ title: "x", stage: "review", commit: "abc1234" }, { ...opts, prs: [] });
  assert.deepEqual([r.ok, r.via], [true, "commit"]);
});

test("auto close: commit on develop, merged PR, closed issue → done with evidence; no evidence → stays open", async () => {
  const { dir, head } = scratchRepo();
  const gh = fakeGh({
    "pr list": [
      { number: 950, state: "MERGED", headRefName: "feat/901-thing", body: "" },
      { number: 951, state: "OPEN", headRefName: "feat/903-open", body: "Closes #903" },
    ],
    "902": { number: 902, state: "CLOSED" },
    "903": { number: 903, state: "OPEN" },
  });
  const issues = createIssueList({ cwd: dir, env: gh.env });
  const { hub, store } = await makeHub(dir);
  store.data.tasks = {
    a: task("a", { title: "E1: by commit", commit: head.slice(0, 7), stage: "review" }),
    b: task("b", { title: "E2: by PR (#901)", stage: "review" }),
    c: task("c", { title: "by issue #902" }),
    d: task("d", { title: "#903 still open", commit: "feat/903-open" }),
    e: task("e", { title: "no refs at all" }),
    f: task("f", { title: "#902 blocked", stage: "blocked", etaAt: null }),
    g: task("g", { title: "E3: fresh branch", commit: "feat/904-fresh", stage: "impl" }),
    h: task("h", { title: "E4: #902 후속", stage: "impl" }),
    i: task("i", { title: "E5: merged branch", commit: "feat/905-done", stage: "impl", lead: "gone" }),
    j: task("j", { title: "E6: hash in impl", commit: head, stage: "impl" }),
  };
  const events = [];
  hub.on("tasks", () => events.push("tasks"));

  const closed = await hub.autoCloseTasks(issues);
  assert.deepEqual(closed.sort(), ["a", "b", "c", "i"]);
  const t = store.data.tasks;
  assert.equal(t.a.stage, "done");
  assert.deepEqual([t.a.mergeCheck.ok, t.a.mergeCheck.via, t.a.mergeCheck.commit, t.a.mergeCheck.base], [true, "commit", head, "develop"]);
  assert.match(t.a.mergeCheck.evidence, /커밋 [0-9a-f]{7}이 develop에 있어요/);
  assert.deepEqual([t.b.stage, t.b.mergeCheck.via, t.b.mergeCheck.evidence], ["done", "pr", "PR #950이 병합됐어요"]);
  assert.deepEqual([t.c.stage, t.c.mergeCheck.via, t.c.mergeCheck.evidence], ["done", "issue", "이슈 #902이 닫혔어요"]);
  // Merged branch with its own commits closes even when its lead session is gone.
  assert.deepEqual([t.i.stage, t.i.mergeCheck.via], ["done", "commit"]);
  // Fresh branch, a title that only mentions #902, and a hash named in impl stay open.
  for (const id of ["g", "h", "j"]) assert.equal(t[id].stage, "impl", id);
  assert.match(t.g.autoCheck.reason, /브랜치에 새 커밋이 없어요/);
  for (const id of ["a", "b", "c", "i"]) {
    assert.equal(t[id].etaAt, null);
    assert.equal(t[id].stuck, null);
    assert.equal(t[id].stages.at(-1).stage, "done");
  }
  // No evidence: stage kept, reason recorded, nothing in mergeCheck.
  assert.equal(t.d.stage, "merge");
  assert.equal(t.d.mergeCheck, undefined);
  assert.match(t.d.autoCheck.reason, /병합 근거가 없어 열어 뒀어요/);
  assert.match(t.e.autoCheck.reason, /커밋과 이슈 번호가 없어/);
  assert.equal(t.f.stage, "blocked");
  assert.equal(events.length, 1);
  // Only gh metadata calls: one pr list, one issue list, issue views.
  for (const c of gh.calls()) assert.ok(["pr list", "issue list", "issue view"].includes(c.args.slice(0, 2).join(" ")), c.args.join(" "));

  // Closed tasks get no late row; the open one's late row says why it was not closed.
  const rows = attentionItems({ sessions: [], tasks: Object.values(t), limits: null, now: Date.now(), stateOf: () => "resting" });
  assert.deepEqual(rows.filter(r => r.kind === "late").map(r => r.key).sort(), ["t:d", "t:e", "t:g", "t:h", "t:j"]);
  assert.match(rows.find(r => r.key === "t:d").reason, /예상 시간을 넘겼어요 · 병합 근거가 없어/);

  // A second run with nothing new changes nothing.
  assert.deepEqual(await hub.autoCloseTasks(issues), []);
  assert.equal(events.length, 1);
});

test("auto close without the gh feed still closes by commit, and runs one at a time", async () => {
  const { dir, head } = scratchRepo();
  const { hub, store } = await makeHub(dir);
  store.data.tasks = { a: task("a", { commit: head }), b: task("b", { title: "x (#5)" }) };
  const [first, second] = await Promise.all([hub.autoCloseTasks(null), hub.autoCloseTasks(null)]);
  assert.deepEqual(first, ["a"]);
  assert.deepEqual(second, []);
  assert.equal(store.data.tasks.b.stage, "merge");
  assert.match(store.data.tasks.b.autoCheck.reason, /PR 정보를 읽지 못했어요/);
});
