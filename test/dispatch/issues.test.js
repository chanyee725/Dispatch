import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bodySummary, closedIssues, createIssueList, referencedIssues } from "../../server/dispatch/issues.js";
import { setPrTracking } from "../../server/dispatch/pr-status.js";
import { FAKE_MARKER } from "../../server/dispatch/cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), "drawing-issues-")); dirs.push(d); return d; };

function fakeGh(scenario) {
  const bin = tmp(), ws = tmp();
  const file = path.join(bin, "gh");
  writeFileSync(file, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(path.join(HERE, "../fixtures/fake-cli/gh.mjs")).href)});\n`);
  chmodSync(file, 0o755);
  writeFileSync(path.join(bin, FAKE_MARKER), "");
  const sc = path.join(bin, "scenario.json");
  writeFileSync(sc, JSON.stringify(scenario));
  const log = path.join(bin, "calls.jsonl");
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : []);
  return { ws, env: { PATH: bin, FAKE_GH_SCENARIO: sc, FAKE_CLI_LOG: log }, calls };
}

const ISSUES = [
  { number: 776, title: "E574: dashboard\u0007 shows issues", url: "https://github.com/o/r/issues/776", body: "secret body", author: { login: "x" } },
  { number: 755, title: "agents panel", url: "javascript:alert(1)" },
  { number: 0, title: "bad" },
];
const PRS = [
  { number: 790, state: "MERGED", headRefName: "feat/776-dashboard-issues", url: "https://github.com/o/r/pull/790", body: "" },
  { number: 801, state: "OPEN", headRefName: "dispatch/impl-1", url: "https://github.com/o/r/pull/801", body: "Closes #776 and fixes: #9", title: "t" },
  { number: 700, state: "CLOSED", headRefName: "--bad", body: "Resolves #755" },
];

test("closedIssues reads GitHub's closing keywords only", () => {
  assert.deepEqual(closedIssues("Closes #776\nfixes: #12, see #13, resolved #14, Fixes #12"), [776, 12, 14]);
  assert.deepEqual(closedIssues(null), []);
  assert.deepEqual(closedIssues("mentions #5"), []);
});

test("referencedIssues reads Refs #n, not closing keywords (#756)", () => {
  assert.deepEqual(referencedIssues("Refs #756\nref: #12, references #13, Closes #14, prefs #15"), [756, 12, 13]);
  assert.deepEqual(referencedIssues(undefined), []);
});

test("listIssues.prsOf answers from the same cached gh run: branch, Closes and Refs, any issue state (#756)", async () => {
  const f = fakeGh({ "issue list": ISSUES, "pr list": [...PRS, { number: 802, state: "OPEN", headRefName: "dispatch/impl-9", body: "Refs #640" }] });
  const list = createIssueList({ workspaceDir: f.ws, cwd: f.ws, env: f.env, now: () => 0 });
  assert.deepEqual((await list.prsOf(776)).prs.map(p => p.number), [801, 790]);
  assert.deepEqual(await list.prsOf(640), { ok: true, prs: [{ number: 802, state: "open", branch: "dispatch/impl-9" }] });
  const r = await list();
  assert.equal(r.prs, undefined, "GET /api/issues answer stays issues only");
  assert.equal(f.calls().length, 2);
});

test("listIssues matches PRs by branch name and Closes, keeps metadata only", async () => {
  const f = fakeGh({ "issue list": ISSUES, "pr list": PRS });
  const out = (await createIssueList({ workspaceDir: f.ws, cwd: f.ws, env: f.env })()).issues;
  assert.deepEqual(out, [
    { number: 776, title: "E574: dashboard  shows issues", url: "https://github.com/o/r/issues/776", prs: [
      { number: 801, state: "open", url: "https://github.com/o/r/pull/801", branch: "dispatch/impl-1" },
      { number: 790, state: "merged", url: "https://github.com/o/r/pull/790", branch: "feat/776-dashboard-issues" },
    ] },
    { number: 755, title: "agents panel", prs: [{ number: 700, state: "closed" }] },
  ]);
  assert.ok(!JSON.stringify(out).includes("secret"));
});

test("listIssues runs gh read-only, caches, and follows the PR tracking switch", async () => {
  const f = fakeGh({ "issue list": ISSUES, "pr list": PRS });
  let t = 0;
  const list = createIssueList({ workspaceDir: f.ws, cwd: f.ws, env: f.env, now: () => t });
  const r = await list();
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues.map(i => i.number), [776, 755]);
  const calls = f.calls();
  assert.equal(calls.length, 2);
  for (const c of calls) assert.equal(c.args[1], "list");
  await list();
  assert.equal(f.calls().length, 2, "second call within cacheMs uses the cache");
  t = 61_000;
  await list();
  assert.equal(f.calls().length, 4);
  await setPrTracking(f.ws, false);
  assert.deepEqual(await list({ force: true }), { ok: false, reason: "disabled" });
  assert.equal(f.calls().length, 4);
});

test("listIssues reports why gh failed", async () => {
  const f = fakeGh({ "issue list": { error: "To get started with GitHub CLI, please run:  gh auth login" } });
  assert.deepEqual(await createIssueList({ workspaceDir: f.ws, cwd: f.ws, env: f.env })(), { ok: false, reason: "not-logged-in" });
  const enoent = () => Promise.reject(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }));
  assert.deepEqual(await createIssueList({ cwd: f.ws, run: enoent })(), { ok: false, reason: "gh-missing" });
  assert.deepEqual(await createIssueList({ cwd: "" })(), { ok: false, reason: "error" });
});

test("GET /api/issues answers from d.issues and does not shadow /api/issues/:n/accounts", async () => {
  const { routeTable } = await import("../../server/dispatch/routes.js");
  const table = routeTable({ root: "/x", store: {}, hub: {}, models: [], broadcast: () => {}, issues: async () => ({ ok: true, issues: [] }) });
  const hits = p => table.filter(([m, re]) => m === "GET" && re.test(p));
  assert.equal(hits("/api/issues").length, 1);
  assert.deepEqual(await hits("/api/issues")[0][2]([]), { ok: true, issues: [] });
  assert.equal(hits("/api/issues/776/accounts").length, 1);
  assert.notEqual(hits("/api/issues/776/accounts")[0], hits("/api/issues")[0]);
  assert.equal(hits("/api/issues/954/summary").length, 1);
  assert.deepEqual(await hits("/api/issues/954/summary")[0][2](["954"]), { ok: false, reason: "disabled" });
  const issues = Object.assign(async () => ({ ok: true, issues: [] }), { summary: async n => ({ ok: true, summary: [`#${n}`] }) });
  const t2 = routeTable({ root: "/x", store: {}, hub: {}, models: [], broadcast: () => {}, issues });
  const s = t2.find(([m, re]) => m === "GET" && re.test("/api/issues/954/summary"));
  assert.deepEqual(await s[2](["954"]), { ok: true, summary: ["#954"] });
});

test("bodySummary keeps the first plain lines of an issue body (#954)", () => {
  const body = "## Goal\n\n대시보드 **이슈** 카드에서 [이슈](https://x/y)를 누르면\n```js\ncode()\n```\n- [ ] 오른쪽 패널\n<!-- c -->\n---\n4번째 줄";
  assert.deepEqual(bodySummary(body), ["Goal", "대시보드 이슈 카드에서 이슈를 누르면", "오른쪽 패널"]);
  assert.deepEqual(bodySummary("a\u0007b " + "x".repeat(200), { lines: 1, width: 10 }), ["a b xxxxx…"]);
  assert.deepEqual(bodySummary(null), []);
});

test("listIssues.summary reads one issue body through gh issue view, caches it, follows the switch (#954)", async () => {
  const f = fakeGh({ "954": { number: 954, body: "첫 줄\n둘째 줄" } });
  let t = 0;
  const list = createIssueList({ workspaceDir: f.ws, cwd: f.ws, env: f.env, now: () => t });
  assert.deepEqual(await list.summary(954), { ok: true, summary: ["첫 줄", "둘째 줄"] });
  assert.deepEqual(await list.summary(954), { ok: true, summary: ["첫 줄", "둘째 줄"] });
  assert.deepEqual(f.calls().map(c => c.args), [["issue", "view", "--json", "number,body", "--", "954"]]);
  assert.equal((await list.summary(1)).ok, false);
  assert.deepEqual(await list.summary(0), { ok: false, reason: "error" });
  t = 1e9;
  await setPrTracking(f.ws, false);
  assert.deepEqual(await list.summary(954), { ok: false, reason: "disabled" });
});
