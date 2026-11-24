import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readdirSync, symlinkSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPrStatus, prTrackingEnabled, rollupCi, setPrTracking, validBranch } from "../../server/dispatch/pr-status.js";
import { FAKE_MARKER } from "../../server/dispatch/cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), "drawing-pr-")); dirs.push(d); return d; };

function fakeGh(scenario, extra = {}) {
  const bin = tmp(), ws = tmp();
  const file = path.join(bin, "gh");
  writeFileSync(file, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(path.join(HERE, "../fixtures/fake-cli/gh.mjs")).href)});\n`);
  chmodSync(file, 0o755);
  writeFileSync(path.join(bin, FAKE_MARKER), ""); // cli.js only starts gh from a fake folder under npm test
  const sc = path.join(bin, "scenario.json");
  writeFileSync(sc, JSON.stringify(scenario));
  const log = path.join(bin, "calls.jsonl");
  const env = { PATH: bin, FAKE_GH_SCENARIO: sc, FAKE_CLI_LOG: log, ...extra };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").slice(0, -1).filter(Boolean).length : 0);
  return { bin, ws, env, calls };
}

const OK = { number: 88, state: "OPEN", title: "secret title", author: { login: "x" }, statusCheckRollup: [{ conclusion: "SUCCESS" }, { status: "COMPLETED", conclusion: "SKIPPED" }] };

test("returns number, state and ci only", async () => {
  const f = fakeGh({ "feat/a": OK });
  const get = createPrStatus({ workspaceDir: f.ws, cwd: f.ws, env: f.env, minGapMs: 0 });
  assert.deepEqual(await get("feat/a"), { ok: true, pr: { number: 88, state: "open", ci: "success" } });
});

test("ci rollup states", () => {
  assert.equal(rollupCi([]), "none");
  assert.equal(rollupCi([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }]), "failure");
  assert.equal(rollupCi([{ conclusion: "SUCCESS" }, { status: "IN_PROGRESS", conclusion: "" }]), "pending");
  assert.equal(rollupCi([{ state: "SUCCESS" }]), "success");
});

test("no pr, not logged in, gh missing, timeout, bad branch", async () => {
  const f = fakeGh({ "b/auth": { error: "To get started with GitHub CLI, please run:  gh auth login" } });
  const get = createPrStatus({ workspaceDir: f.ws, cwd: f.ws, env: f.env, minGapMs: 0 });
  assert.deepEqual(await get("b/none"), { ok: false, reason: "no-pr" });
  assert.deepEqual(await get("b/auth"), { ok: false, reason: "not-logged-in" });
  assert.deepEqual(await get("--web"), { ok: false, reason: "invalid-branch" });
  const enoent = () => Promise.reject(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }));
  const missing = createPrStatus({ workspaceDir: f.ws, cwd: f.ws, run: enoent, minGapMs: 0 });
  assert.deepEqual(await missing("b/x"), { ok: false, reason: "gh-missing" });
  const slow = fakeGh({ "b/s": OK }, { FAKE_GH_SLOW: "500" });
  const t = createPrStatus({ workspaceDir: slow.ws, cwd: slow.ws, env: slow.env, minGapMs: 0, timeoutMs: 100 });
  assert.deepEqual(await t("b/s"), { ok: false, reason: "timeout" });
});

test("caches per branch and force skips the cache", async () => {
  const f = fakeGh({ "feat/a": OK });
  const get = createPrStatus({ workspaceDir: f.ws, cwd: f.ws, env: f.env, minGapMs: 0 });
  await get("feat/a"); await get("feat/a");
  assert.equal(f.calls(), 1);
  await get("feat/a", { force: true });
  assert.equal(f.calls(), 2);
});

test("per-workspace switch: default on, off never starts gh", async () => {
  const f = fakeGh({ "feat/a": OK });
  assert.equal(await prTrackingEnabled(f.ws), true);
  await setPrTracking(f.ws, false);
  assert.equal(await prTrackingEnabled(f.ws), false);
  const get = createPrStatus({ workspaceDir: f.ws, cwd: f.ws, env: f.env, minGapMs: 0 });
  assert.deepEqual(await get("feat/a"), { ok: false, reason: "disabled" });
  assert.equal(f.calls(), 0);
  await setPrTracking(f.ws, true);
  assert.equal((await get("feat/a")).ok, true);
});

test("setPrTracking never writes outside the workspace through symlinks", async () => {
  // symlinked .drawing
  const a = fakeGh({}), outA = tmp();
  symlinkSync(outA, path.join(a.ws, ".drawing"));
  await assert.rejects(setPrTracking(a.ws, false));
  assert.deepEqual(readdirSync(outA), []);
  // symlinked settings.json
  const b = fakeGh({}), outB = tmp();
  const target = path.join(outB, "victim.json");
  writeFileSync(target, "{}");
  mkdirSync(path.join(b.ws, ".drawing"));
  symlinkSync(target, path.join(b.ws, ".drawing", "settings.json"));
  await assert.rejects(setPrTracking(b.ws, false));
  assert.equal(readFileSync(target, "utf8"), "{}");
  assert.deepEqual(readdirSync(outB), ["victim.json"]);
  assert.deepEqual(readdirSync(path.join(b.ws, ".drawing")), ["settings.json"]);
});

test("setPrTracking refuses to overwrite a corrupt or non-object settings.json", async () => {
  for (const bad of ["{ not json", "[1,2]", "null", "\"on\"", "42"]) {
    const ws = tmp();
    mkdirSync(path.join(ws, ".drawing"));
    const file = path.join(ws, ".drawing", "settings.json");
    writeFileSync(file, bad);
    await assert.rejects(setPrTracking(ws, false), e => e.code === "ESETTINGS", bad);
    assert.equal(readFileSync(file, "utf8"), bad, bad);
    assert.deepEqual(readdirSync(path.join(ws, ".drawing")), ["settings.json"], bad); // no temp file left
    assert.equal(await prTrackingEnabled(ws), true, bad); // unreadable file reads as the default
  }
});

test("setPrTracking keeps the other keys", async () => {
  const ws = tmp();
  mkdirSync(path.join(ws, ".drawing"));
  const file = path.join(ws, ".drawing", "settings.json");
  writeFileSync(file, JSON.stringify({ theme: "dark", nested: { a: 1 } }));
  await setPrTracking(ws, false);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { theme: "dark", nested: { a: 1 }, prStatus: false });
});

test("gh starts at most once per minGapMs even when calls overlap", async () => {
  // Fake clock and timers: the gaps are exact, so load on the machine cannot shrink them.
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  try {
    const starts = [];
    const run = async (_bin, args) => { starts.push({ at: Date.now(), branch: args.at(-1) }); return { stdout: JSON.stringify(OK) }; };
    const get = createPrStatus({ cwd: tmp(), run, minGapMs: 80 });
    const flush = () => new Promise(r => setImmediate(r));
    const all = Promise.all(["b/1", "b/2", "b/3"].map(b => get(b)));
    await flush();
    assert.deepEqual(starts, [{ at: 1000, branch: "b/1" }]);
    mock.timers.tick(79); await flush();
    assert.equal(starts.length, 1, "second start waits the full gap");
    mock.timers.tick(1); await flush();
    assert.deepEqual(starts.at(-1), { at: 1080, branch: "b/2" });
    mock.timers.tick(79); await flush();
    assert.equal(starts.length, 2, "third start waits the full gap");
    mock.timers.tick(1); await flush();
    assert.deepEqual(starts.at(-1), { at: 1160, branch: "b/3" });
    assert.equal((await all).every(r => r.ok), true);
  } finally {
    mock.timers.reset();
  }
});

test("cwd is required, and gh gets the branch after --", async () => {
  const calls = [];
  const run = async (bin, args, opts) => { calls.push({ args, cwd: opts.cwd }); return { stdout: JSON.stringify(OK) }; };
  assert.deepEqual(await createPrStatus({ run, minGapMs: 0 })("feat/a"), { ok: false, reason: "error" });
  assert.equal(calls.length, 0);
  const cwd = tmp();
  assert.equal((await createPrStatus({ cwd, run, minGapMs: 0 })("feat/a")).ok, true);
  assert.deepEqual(calls[0].args.slice(-2), ["--", "feat/a"]);
  assert.equal(calls[0].cwd, cwd);
});

test("branch validation rejects PR numbers, URLs and odd refs", () => {
  for (const ok of ["feat/a", "fix/e23-pr.status_2", "develop", "v1.2"]) assert.equal(validBranch(ok), true, ok);
  for (const bad of ["", "123", "https://github.com/o/r/pull/1", "--web", "-x", "/abs", "a..b", "a b", "a\0b", "x".repeat(256), 7, null]) {
    assert.equal(validBranch(bad), false, String(bad));
  }
});
