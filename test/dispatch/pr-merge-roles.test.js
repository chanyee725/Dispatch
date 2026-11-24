// PR and merge roles (#1031): only the pr role opens PRs and only the merge role merges; both look at the open PRs
// first so one issue never gets two PRs merged. The checks live in the prompts, so these tests pin the wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLES, SPAWN_PROMPT, CHILD_PROMPT } from "../../server/dispatch/roles.js";

const role = id => ROLES.find(r => r.id === id);

test("pr and merge roles exist on small models and cannot spawn sessions", () => {
  const pr = role("pr");
  const merge = role("merge");
  assert.equal(pr?.name, "PR 담당");
  assert.equal(merge?.name, "머지 담당");
  for (const r of [pr, merge]) {
    assert.match(r.model, /^claude-(sonnet|haiku)-/);
    assert.ok(!r.canSpawn);
    assert.equal(r.perm, "auto");
  }
  assert.equal(new Set(ROLES.map(r => r.id)).size, ROLES.length, "role ids are unique");
});

test("the pr role checks open PRs for the same issue or branch and reports instead of opening a second one", () => {
  const p = role("pr").prompt;
  assert.match(p, /코드는 고치지 않는다/);
  assert.match(p, /gh pr list --state open --json number,headRefName,body/);
  assert.match(p, /같은 브랜치이거나 본문에 같은 Closes #<이슈>/);
  assert.match(p, /있으면 새로 열지 않고 "PR 있음 · #번호"로 보고한다/);
  // The create step comes after the check.
  assert.ok(p.indexOf("gh pr list") < p.indexOf("gh pr create --base develop"));
  assert.doesNotMatch(p, /gh pr merge/);
});

test("the merge role stops on two open PRs for one issue and checks review and risky approval first", () => {
  const p = role("merge").prompt;
  assert.match(p, /gh pr merge는 너만 한다/);
  assert.match(p, /프로젝트마다 머지 담당은 한 명이다/);
  assert.match(p, /하나라도 아니면 머지하지 않고 멈춰/);
  assert.match(p, /must-fix 없음/);
  assert.match(p, /둘 이상이면 "같은 이슈 PR 여러 개 · #a #b"로 보고하고 멈춘다/);
  assert.match(p, /risky lane이면 관리자가 메인 세션의 병합 확인을 전했다/);
  const order = ["gh pr list --state open", "gh pr merge <번호> --merge", "git merge --ff-only origin/develop", 'stage: "done"'];
  const at = order.map(s => p.indexOf(s));
  assert.ok(at.every(i => i >= 0), `all steps named: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, "checks, merge, fast-forward, then the task closes");
  assert.match(p, /x-drawing: 1/);
});

test("the lead hands PRs and merges to the two roles and runs neither command itself", () => {
  const merge = SPAWN_PROMPT.slice(SPAWN_PROMPT.indexOf("[병합]"), SPAWN_PROMPT.indexOf("[작업 보드]"));
  assert.match(merge, /너와 구현자는 PR을 열거나 머지하지 않는다/);
  assert.match(merge, /PR 담당\(pr\)/);
  assert.match(merge, /머지 담당\(merge\)/);
  assert.match(merge, /살아 있는 머지 담당이 있으면 새로 만들지 않고/);
  assert.doesNotMatch(SPAWN_PROMPT, /^1\. gh pr merge/m, "the lead's own merge step is gone");
  assert.doesNotMatch(SPAWN_PROMPT, /네가 병합/);
  assert.doesNotMatch(role("lead").prompt, /PR을 병합한다/);
  assert.doesNotMatch(role("impl").prompt + CHILD_PROMPT, /gh pr (create|merge)/);
});

test("team rules: leads and implementers open no PR and merge nothing; the two roles check open PRs", async () => {
  const { readFileSync } = await import("node:fs");
  const rules = readFileSync(new URL("../../plugin/skills/atelier-team/reference/rules.md", import.meta.url), "utf8");
  assert.match(rules, /Leads and implementers open no PR and merge nothing/);
  assert.match(rules, /PR role \(`pr`\): changes no code/);
  assert.match(rules, /Merge role \(`merge`, one per project\): the only one who runs `gh pr merge --merge`/);
  assert.match(rules, /two or more: stop and report/);
  assert.doesNotMatch(rules, /The main session merges/);
});
