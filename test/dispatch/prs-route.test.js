// GET /api/prs and the createPrStatus fields the dashboard reads (#695): url, review, conflict, and the
// maxConcurrent cap (#691). gh is the fake in test/fixtures/fake-cli/gh.mjs or an in-process `run`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPrStatus, setPrTracking } from "../../server/dispatch/pr-status.js";
import { routeTable } from "../../server/dispatch/routes.js";
import { FAKE_MARKER } from "../../server/dispatch/cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), "drawing-prs-")); dirs.push(d); return d; };

function fakeGh(scenario) {
  const bin = tmp(), ws = tmp();
  const file = path.join(bin, "gh");
  writeFileSync(file, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(path.join(HERE, "../fixtures/fake-cli/gh.mjs")).href)});\n`);
  chmodSync(file, 0o755);
  writeFileSync(path.join(bin, FAKE_MARKER), "");
  const sc = path.join(bin, "scenario.json");
  writeFileSync(sc, JSON.stringify(scenario));
  const log = path.join(bin, "calls.jsonl");
  const env = { PATH: bin, FAKE_GH_SCENARIO: sc, FAKE_CLI_LOG: log };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : []);
  return { ws, env, calls };
}

const pr = (number, extra = {}) => ({ number, state: "OPEN", statusCheckRollup: [], ...extra });

function prsRoute(prStatus) {
  const table = routeTable({ root: "/x", store: {}, hub: {}, models: [], broadcast: () => {}, prStatus });
  const hits = table.filter(([m, re]) => m === "GET" && re.test("/api/prs"));
  assert.equal(hits.length, 1);
  return branches => hits[0][2]([], {}, new URL(`http://127.0.0.1/api/prs${branches == null ? "" : `?branches=${branches}`}`));
}

test("GET /api/prs dedupes branches and asks gh once per branch", async () => {
  const f = fakeGh({ "feat/a": pr(1), "feat/b": pr(2) });
  const get = prsRoute(createPrStatus({ workspaceDir: f.ws, cwd: f.ws, env: f.env, minGapMs: 0 }));
  const { prs } = await get("feat/a,feat/b,feat/a,,feat/b");
  assert.deepEqual(Object.keys(prs).sort(), ["feat/a", "feat/b"]);
  assert.deepEqual(prs["feat/a"], { ok: true, pr: { number: 1, state: "open", ci: "none" } });
  assert.equal(f.calls().length, 2);
  assert.deepEqual(await get(""), { prs: {} });
  assert.deepEqual(await get(null), { prs: {} });
});

test("GET /api/prs answers at most 12 branches per call", async () => {
  const asked = [];
  const get = prsRoute(async b => { asked.push(b); return { ok: false, reason: "no-pr" }; });
  const list = Array.from({ length: 20 }, (_, i) => `b/${i}`);
  const { prs } = await get(list.join(","));
  assert.deepEqual(Object.keys(prs), list.slice(0, 12));
  assert.deepEqual(asked, list.slice(0, 12));
});

test("GET /api/prs says disabled per branch when PR tracking is off, and starts no gh", async () => {
  const f = fakeGh({ "feat/a": pr(1) });
  await setPrTracking(f.ws, false);
  const get = prsRoute(createPrStatus({ workspaceDir: f.ws, cwd: f.ws, env: f.env, minGapMs: 0 }));
  assert.deepEqual(await get("feat/a,feat/b"), { prs: { "feat/a": { ok: false, reason: "disabled" }, "feat/b": { ok: false, reason: "disabled" } } });
  assert.equal(f.calls().length, 0);
});

test("GET /api/prs without a prStatus answers an empty map", async () => {
  assert.deepEqual(await prsRoute(undefined)("feat/a"), { prs: {} });
});

test("url is kept only for plain github.com PR links", async () => {
  const urls = {
    "u/ok": "https://github.com/o/r/pull/12",
    "u/http": "http://github.com/o/r/pull/12",
    "u/host": "https://evil.example/o/r/pull/12",
    "u/sub": "https://github.com.evil.example/o/r/pull/12",
    "u/issue": "https://github.com/o/r/issues/12",
    "u/tail": "https://github.com/o/r/pull/12?x=1",
    "u/js": "javascript:alert(1)",
    "u/num": 12,
  };
  const f = fakeGh(Object.fromEntries(Object.entries(urls).map(([b, url]) => [b, pr(12, { url })])));
  const get = createPrStatus({ workspaceDir: f.ws, cwd: f.ws, env: f.env, minGapMs: 0 });
  assert.equal((await get("u/ok")).pr.url, "https://github.com/o/r/pull/12");
  for (const b of Object.keys(urls).filter(b => b !== "u/ok")) {
    const r = await get(b);
    assert.equal(r.ok, true, b);
    assert.equal("url" in r.pr, false, b);
  }
});

test("review maps APPROVED, CHANGES_REQUESTED and REVIEW_REQUIRED; anything else is left out", async () => {
  const f = fakeGh({
    "r/a": pr(1, { reviewDecision: "APPROVED" }),
    "r/c": pr(2, { reviewDecision: "CHANGES_REQUESTED" }),
    "r/r": pr(3, { reviewDecision: "REVIEW_REQUIRED" }),
    "r/none": pr(4, { reviewDecision: "" }),
    "r/odd": pr(5, { reviewDecision: "SOMETHING_NEW" }),
  });
  const get = createPrStatus({ workspaceDir: f.ws, cwd: f.ws, env: f.env, minGapMs: 0 });
  assert.equal((await get("r/a")).pr.review, "approved");
  assert.equal((await get("r/c")).pr.review, "changes");
  assert.equal((await get("r/r")).pr.review, "required");
  assert.equal("review" in (await get("r/none")).pr, false);
  assert.equal("review" in (await get("r/odd")).pr, false);
});

test("conflict is set only when mergeable is CONFLICTING", async () => {
  const f = fakeGh({
    "m/c": pr(1, { mergeable: "CONFLICTING" }),
    "m/m": pr(2, { mergeable: "MERGEABLE" }),
    "m/u": pr(3, { mergeable: "UNKNOWN" }),
  });
  const get = createPrStatus({ workspaceDir: f.ws, cwd: f.ws, env: f.env, minGapMs: 0 });
  assert.deepEqual((await get("m/c")).pr, { number: 1, state: "open", ci: "none", conflict: true });
  assert.deepEqual((await get("m/m")).pr, { number: 2, state: "open", ci: "none", mergeable: true });
  assert.deepEqual((await get("m/u")).pr, { number: 3, state: "open", ci: "none" });
});

test("maxConcurrent: never more than N gh calls run at once", async () => {
  const N = 3;
  let running = 0, peak = 0, started = 0;
  const gates = [];
  const run = async (_bin, args) => {
    running++; started++;
    peak = Math.max(peak, running);
    await new Promise(r => gates.push(r));
    running--;
    return { stdout: JSON.stringify(pr(Number(args.at(-1).split("/")[1]))) };
  };
  const get = createPrStatus({ cwd: tmp(), run, minGapMs: 0, maxConcurrent: N });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
  const branches = Array.from({ length: 10 }, (_, i) => `b/${i + 1}`);
  const all = Promise.all(branches.map(b => get(b)));
  await flush();
  assert.equal(started, N, "only N start before any finishes");
  // Release one call at a time; each freed slot goes to the next waiter.
  while (gates.length) {
    gates.shift()();
    await flush();
    assert.ok(running <= N, `running ${running} > ${N}`);
  }
  const results = await all;
  assert.equal(started, 10);
  assert.equal(peak, N);
  assert.deepEqual(results.map(r => r.pr.number), branches.map((_, i) => i + 1));
});
