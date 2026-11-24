// One accounts-summary comment per PR through `gh api` (#756), against the fake gh.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ACCOUNTS_MARKER, accountsCommentBody, createAccountsComment } from "../../server/dispatch/pr-comment.js";
import { setPrTracking } from "../../server/dispatch/pr-status.js";
import { FAKE_MARKER } from "../../server/dispatch/cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), "drawing-prc-")); dirs.push(d); return d; };

function fakeGh(scenario) {
  const bin = tmp(), ws = tmp();
  const file = path.join(bin, "gh");
  writeFileSync(file, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(path.join(HERE, "../fixtures/fake-cli/gh.mjs")).href)});\n`);
  chmodSync(file, 0o755);
  writeFileSync(path.join(bin, FAKE_MARKER), "");
  const sc = path.join(bin, "scenario.json");
  writeFileSync(sc, JSON.stringify(scenario));
  const log = path.join(bin, "calls.jsonl");
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).args) : []);
  return { ws, env: { PATH: bin, FAKE_GH_SCENARIO: sc, FAKE_CLI_LOG: log }, calls };
}

const LIST = "api GET repos/{owner}/{repo}/issues/12/comments";
const SUMMARY = "roles: lead Claude Sonnet 5.5 (Claude · Max)";

test("accountsCommentBody starts with the marker and holds only the issue and the line", () => {
  assert.equal(accountsCommentBody(756, SUMMARY), `${ACCOUNTS_MARKER}\n**#756** ${SUMMARY}`);
});

test("postAccounts creates the comment when the PR has none", async () => {
  const f = fakeGh({ [LIST]: { stdout: "" }, "api POST repos/{owner}/{repo}/issues/12/comments": { stdout: "555\n" } });
  const post = createAccountsComment({ workspaceDir: f.ws, cwd: f.ws, env: f.env });
  assert.deepEqual(await post({ pr: 12, issue: 756, summary: SUMMARY }), { ok: true, pr: 12, comment: "created", id: 555 });
  const [list, create] = f.calls();
  assert.deepEqual(list.slice(0, 3), ["api", "--paginate", "repos/{owner}/{repo}/issues/12/comments"]);
  assert.match(list.at(-1), /startswith\("<!-- atelier:accounts -->"\)/);
  assert.deepEqual(create.slice(0, 5), ["api", "-X", "POST", "repos/{owner}/{repo}/issues/12/comments", "-f"]);
  assert.equal(create[5], `body=${accountsCommentBody(756, SUMMARY)}`);
});

test("postAccounts updates the newest marked comment it can edit, else creates", async () => {
  const f = fakeGh({
    [LIST]: { stdout: "100\n200\n" },
    "api PATCH repos/{owner}/{repo}/issues/comments/200": { error: "HTTP 403: Resource not accessible" },
    "api PATCH repos/{owner}/{repo}/issues/comments/100": { stdout: "100\n" },
  });
  const post = createAccountsComment({ workspaceDir: f.ws, cwd: f.ws, env: f.env });
  assert.deepEqual(await post({ pr: 12, issue: 756, summary: SUMMARY }), { ok: true, pr: 12, comment: "updated", id: 100 });
  assert.deepEqual(f.calls().map(a => `${a[2]} ${a[3]}`), ["repos/{owner}/{repo}/issues/12/comments --jq", "PATCH repos/{owner}/{repo}/issues/comments/200", "PATCH repos/{owner}/{repo}/issues/comments/100"]);
});

test("postAccounts follows the PR tracking switch and reports gh failures", async () => {
  const f = fakeGh({ [LIST]: { error: "To get started with GitHub CLI, please run:  gh auth login" } });
  const post = createAccountsComment({ workspaceDir: f.ws, cwd: f.ws, env: f.env });
  assert.deepEqual(await post({ pr: 12, issue: 756, summary: SUMMARY }), { ok: false, reason: "not-logged-in" });
  assert.deepEqual(await post({ pr: 0, issue: 756, summary: SUMMARY }), { ok: false, reason: "error" });
  await setPrTracking(f.ws, false);
  const n = f.calls().length;
  assert.deepEqual(await post({ pr: 12, issue: 756, summary: SUMMARY }), { ok: false, reason: "disabled" });
  assert.equal(f.calls().length, n);
});
