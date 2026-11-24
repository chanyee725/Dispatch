// Safety rules from CLAUDE.md, checked by reading the source and by running the CLI seam:
// child processes only through server/dispatch/cli.js and never with a shell, loopback only,
// no real agent CLI under npm test, every mode on every provider as strict as chosen.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_MARKER, runCli, spawnCli } from "../../server/dispatch/cli.js";
import { Hub } from "../../server/dispatch/hub.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";
import { fakeCliBin, fakeSpawner, until } from "../fixtures/fake-cli/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = prefix => { const d = mkdtempSync(path.join(tmpdir(), prefix)); dirs.push(d); return d; };

function sources(dir) {
  const out = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.(c|m)?js$/.test(e.name)) out.push({ rel, text: readFileSync(path.join(ROOT, rel), "utf8") });
  }
  return out;
}
const CODE = [...sources("server"), ...sources("plugin")];
const hits = re => CODE.filter(f => re.test(f.text)).map(f => f.rel).sort();

/* ---------------- static checks ---------------- */

test("static: child_process is imported only in server/dispatch/cli.js", () => {
  assert.deepEqual(hits(/["'](node:)?child_process["']/), ["server/dispatch/cli.js"]);
});

test("static: no shell option is ever turned on", () => {
  assert.deepEqual(hits(/shell\s*:\s*(true|["'`])/), []);
  assert.deepEqual(hits(/\bexecSync\b|(?<![.\w])exec\(/), []);
});

test("static: no other network modules, fetch only in mcp.js, the hook and the lock probe", () => {
  assert.deepEqual(hits(/["'](node:)?(https|net|tls|dgram|http2)["']/), []);
  assert.deepEqual(hits(/\b(http|https)\.(request|get)\(|new WebSocket\(|XMLHttpRequest/), []);
  assert.deepEqual(hits(/\bfetch(Fn)?\(/), ["plugin/hooks/long-session.mjs", "server/dispatch/mcp.js", "server/lock.js"]);
  // The lock probe (E13) only ever asks 127.0.0.1: a fixed host, and one fetch built from it.
  const lock = CODE.find(f => f.rel === "server/lock.js").text;
  assert.match(lock, /^const HOST = '127\.0\.0\.1';$/m);
  assert.deepEqual(lock.match(/\bfetch\([^,]*/g), ["fetch(`http://${HOST}:${port}${path}`"]);
  // Both refuse a DISPATCH_URL that is not this machine's loopback.
  for (const rel of ["plugin/hooks/long-session.mjs", "server/dispatch/mcp.js"]) {
    const text = CODE.find(f => f.rel === rel).text;
    assert.match(text, /\^http:\\\/\\\/127\\\.0\\\.0\\\.1:\\d\+\$/, rel);
  }
});

test("static: the server listens on 127.0.0.1 only", () => {
  const listens = CODE.filter(f => /\.listen\(/.test(f.text));
  assert.deepEqual(listens.map(f => f.rel), ["server/index.js"]);
  const text = listens[0].text;
  assert.match(text, /const HOST = '127\.0\.0\.1';/);
  assert.match(text, /\.listen\(port, HOST,/);
});

/* ---------------- cli.js ---------------- */

test("cli: refuses anything outside the allowlist, and any shell", async () => {
  for (const bin of ["cp", "sh", "bash", "node", "/usr/bin/git", "claude; rm -rf /"]) {
    assert.throws(() => spawnCli(bin, []), e => e.code === "ECLIDENIED", bin);
    await assert.rejects(runCli(bin, []), e => e.code === "ECLIDENIED", bin);
  }
  assert.throws(() => spawnCli("git", ["--version"], { shell: true }), e => e.code === "ECLIDENIED");
  await assert.rejects(runCli("git", ["--version"], { shell: "/bin/sh" }), e => e.code === "ECLIDENIED");
});

test("cli: a real agent CLI or gh never starts under npm test", async () => {
  // An executable named claude, codex, agy or gh in a folder without the fake marker counts as real.
  const dir = tmp("drawing-real-cli-");
  for (const bin of ["claude", "codex", "agy", "gh"]) {
    writeFileSync(path.join(dir, bin), `#!${process.execPath}\nprocess.exit(0);\n`);
    chmodSync(path.join(dir, bin), 0o755);
    const env = { ...process.env, PATH: dir };
    assert.throws(() => spawnCli(bin, ["--version"], { env }), e => e.code === "ECLIDENIED", bin);
    await assert.rejects(runCli(bin, ["--version"], { env }), e => e.code === "ECLIDENIED", bin);
  }
  // Not on PATH at all: refused too, never looked up elsewhere.
  assert.throws(() => spawnCli("claude", [], { env: { ...process.env, PATH: tmp("drawing-empty-bin-") } }), e => e.code === "ECLIDENIED");
  await assert.rejects(runCli("gh", ["--version"], { env: { ...process.env, PATH: tmp("drawing-empty-bin-") } }), e => e.code === "ECLIDENIED");
});

test("cli: the real seam runs each fake agent CLI from a marked folder; others are refused", async () => {
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const env = { ...process.env, ...bin.env };
  for (const name of ["claude", "codex", "agy"]) {
    const { stdout } = await runCli(name, ["--version"], { env });
    assert.equal(stdout.trim(), `${name} 0.0.0-fake`);
  }
  assert.deepEqual(bin.calls().map(c => c.bin), ["claude", "codex", "agy"]);
  // A CLI outside the list never starts, even with a same-named file on PATH.
  for (const name of ["gemini", "sh", "node"]) {
    assert.throws(() => spawnCli(name, ["--version"], { env }), e => e.code === "ECLIDENIED", name);
  }
  // No shell, for any CLI.
  assert.throws(() => spawnCli("codex", ["--version"], { env, shell: true }), e => e.code === "ECLIDENIED");
  // git is not an agent CLI: it runs from the normal PATH.
  assert.match((await runCli("git", ["--version"])).stdout, /^git version/);
  assert.equal(readdirSync(bin.dir).includes(FAKE_MARKER), true);
});

/* ---------------- permission matrix ---------------- */

const MODELS = [
  { id: "claude-fable-5-2", provider: "claude", efforts: ["low"], contextWindow: 200000 },
  { id: "gpt-fake-codex", provider: "openai", efforts: ["low", "medium"], contextWindow: 272000 },
  { id: "gemini-3.8-flash-low", provider: "gemini", efforts: ["low"], contextWindow: 1000000 },
];
const ROLES = [{ id: "impl", name: "구현자", model: "claude-fable-5-2", perm: "plan", prompt: "" }];

async function makeHub(bin, root = tmp("drawing-safety-hub-")) {
  const store = new Store(root);
  await store.load();
  store.save = () => {};
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")), spawnCli: fakeSpawner(bin) });
  after(() => hub.stopAll());
  return { root, store, hub };
}

const flagAfter = (args, flag) => args[args.indexOf(flag) + 1];
// What the Claude CLI must get for each mode.
const MATRIX = { manual: a => flagAfter(a, "--permission-mode") === "manual", acceptEdits: a => flagAfter(a, "--permission-mode") === "acceptEdits",
  auto: a => flagAfter(a, "--permission-mode") === "auto", plan: a => flagAfter(a, "--permission-mode") === "plan" };

test("permission matrix: 4 modes through hub.create, never looser than chosen", async () => {
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const { hub, store } = await makeHub(bin);
  let cells = 0;
  for (const [perm, ok] of Object.entries(MATRIX)) {
    cells++;
    const before = bin.calls().length;
    const [s] = await hub.create({ items: [{ role: "impl", model: "claude-fable-5-2", perm }], commonPrompt: "hi", worktree: false });
    const call = await until(() => bin.calls().slice(before).find(c => c.bin === "claude"));
    assert.equal(ok(call.args), true, `${perm}: ${JSON.stringify(call.args)}`);
    for (const loose of ["--dangerously-skip-permissions", "bypassPermissions", "--yolo", "danger-full-access", "--dangerously-bypass-approvals-and-sandbox"]) {
      assert.equal(call.args.some(a => a.includes(loose)), false, `${perm} got ${loose}`);
    }
    assert.equal(store.data.sessions[s.id].perm, perm);
  }
  assert.equal(cells, 4);
  await assert.rejects(hub.create({ items: [{ role: "impl", perm: "bypassPermissions" }], commonPrompt: "hi", worktree: false }), e => e.status === 400);
  assert.equal(bin.calls().every(c => c.bin === "claude"), true);
});

// Codex and agy run headless with no approval channel (lead decision, #587): Codex runs plan (read-only
// sandbox) and auto (workspace-write) only — workspace-write runs commands without asking, looser than
// acceptEdits; agy runs acceptEdits/auto/plan through its own --mode. Manual is refused for both.
const LOOSE = ["--dangerously-skip-permissions", "bypassPermissions", "--yolo", "danger-full-access", "--dangerously-bypass-approvals-and-sandbox", "--full-auto"];
const OTHER_MATRIX = {
  "gpt-fake-codex": { bin: "codex", plan: 'sandbox_mode="read-only"', auto: 'sandbox_mode="workspace-write"', acceptEdits: null, manual: null },
  "gemini-3.8-flash-low": { bin: "agy", plan: "plan", auto: "auto", acceptEdits: "accept-edits", manual: null },
};

test("permission matrix: Codex and agy get their own strict flag per mode, and the looser modes are refused", async () => {
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const { hub, store } = await makeHub(bin);
  for (const [model, row] of Object.entries(OTHER_MATRIX)) {
    for (const perm of ["manual", "acceptEdits", "auto", "plan"]) {
      const before = bin.calls().length;
      if (row[perm] == null) {
        await assert.rejects(hub.create({ items: [{ role: "impl", model, perm }], commonPrompt: "hi", worktree: false }),
          e => e.status === 400 && e.message.includes(perm), `${model} ${perm}`);
        continue;
      }
      const [s] = await hub.create({ items: [{ role: "impl", model, perm, effort: "low" }], commonPrompt: "hi", worktree: false });
      const call = await until(() => bin.calls().slice(before).find(c => c.bin === row.bin));
      if (row.bin === "codex") {
        assert.equal(call.args[0], "exec");
        assert.ok(call.args.includes(row[perm]), `${perm}: ${JSON.stringify(call.args)}`);
        assert.equal(call.args.filter(a => a.startsWith("sandbox_mode=")).length, 1);
        assert.ok(call.args.includes('model_reasoning_effort="low"'));
      } else {
        assert.equal(flagAfter(call.args, "--mode"), row[perm]);
        assert.equal(flagAfter(call.args, "--model"), model);
      }
      for (const loose of LOOSE) assert.equal(call.args.some(a => a.includes(loose)), false, `${model} ${perm} got ${loose}`);
      assert.equal(store.data.sessions[s.id].perm, perm);
      await until(() => store.data.sessions[s.id].status === "idle");
    }
  }
  // A mode switch to a refused mode is refused too; a saved session with one stops with an error, nothing starts.
  const [s] = await hub.create({ items: [{ role: "impl", model: "gpt-fake-codex", perm: "plan" }], commonPrompt: "hi", worktree: false });
  await until(() => store.data.sessions[s.id].status === "idle");
  assert.throws(() => hub.setPerm(s.id, "acceptEdits"), e => e.status === 400);
  const before = bin.calls().length;
  store.data.sessions[s.id].perm = "manual";
  hub.start(store.data.sessions[s.id], "hi");
  assert.equal(store.data.sessions[s.id].status, "error");
  await new Promise(r => setTimeout(r, 50));
  assert.equal(bin.calls().length, before);
});

test("resumeInterrupted resumes Claude, Codex and Gemini sessions; an unknown provider loads as done and never starts", async () => {
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const root = tmp("drawing-safety-resume-");
  const store = new Store(root);
  await store.load();
  const base = { role: "impl", effort: null, perm: "plan", prompt: "", canSpawn: false, cwd: root, startedAt: 0, updatedAt: 0, last: "",
    turns: 0, ctx: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, providerSessionId: null };
  store.data.sessions = {
    c: { ...base, id: "c", n: 1, name: "C", provider: "claude", model: "claude-fable-5-2", status: "running" },
    o: { ...base, id: "o", n: 2, name: "O", provider: "openai", model: "gpt-fake-codex", status: "running" },
    g: { ...base, id: "g", n: 3, name: "G", provider: "gemini", model: "gemini-3.8-flash-low", status: "waiting" },
    x: { ...base, id: "x", n: 4, name: "X", provider: "cursor", model: "x-model", status: "running", interrupted: true },
  };
  store.save = () => {};
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")), spawnCli: fakeSpawner(bin) });
  after(() => hub.stopAll());
  for (const id of ["c", "o", "g"]) assert.equal(store.data.sessions[id].interrupted, true, id);
  assert.equal(store.data.sessions.x.status, "done");
  assert.equal(store.data.sessions.x.interrupted, false);

  hub.isConnected = () => true;
  hub.resumeInterrupted();
  await until(() => bin.calls().length >= 3);
  await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(bin.calls().map(c => c.bin).sort(), ["agy", "claude", "codex"]);

  // send refuses an unknown-provider session before anything is pushed to its transcript or any CLI starts.
  const before = hub.transcript("x").length;
  assert.throws(() => hub.send("x", "hello", { force: true }), /지원하지 않는 모델/);
  assert.equal(hub.transcript("x").length, before);
  hub.start(store.data.sessions.x, "hi");
  assert.equal(store.data.sessions.x.status, "error");
  await new Promise(r => setTimeout(r, 50));
  assert.equal(bin.calls().length, 3);
});

test("send and resume refuse a saved session whose provider is disconnected or whose model is gone, before any spawn", async () => {
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const root = tmp("drawing-safety-saved-");
  const store = new Store(root);
  await store.load();
  const base = { role: "impl", effort: null, perm: "plan", prompt: "", canSpawn: false, cwd: root, startedAt: 0, updatedAt: 0, last: "",
    turns: 0, ctx: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, providerSessionId: "p1", status: "idle" };
  store.data.sessions = {
    o: { ...base, id: "o", n: 1, name: "O", provider: "openai", model: "gpt-fake-codex" },
    m: { ...base, id: "m", n: 2, name: "M", provider: "claude", model: "claude-gone-1" },
    r: { ...base, id: "r", n: 3, name: "R", provider: "openai", model: "gpt-fake-codex", status: "running" },
  };
  store.save = () => {};
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")), spawnCli: fakeSpawner(bin) });
  after(() => hub.stopAll());
  hub.isConnected = p => p === "claude";

  // A disconnected provider: nothing recorded, nothing spawned.
  const before = hub.transcript("o").length;
  assert.throws(() => hub.send("o", "hello"), /OpenAI Codex가 Drawing에 연결되지 않았어요/);
  assert.equal(hub.transcript("o").length, before);
  // A model that is no longer listed never reaches -m / --model.
  assert.throws(() => hub.send("m", "hello"), /claude-gone-1 모델을 지금은 쓸 수 없어요/);
  hub.start(store.data.sessions.o, "hi");
  assert.equal(store.data.sessions.o.status, "error");
  // An interrupted session waits for its provider instead of failing; it resumes once connected.
  hub.resumeInterrupted();
  assert.equal(store.data.sessions.r.interrupted, true);
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(bin.calls(), []);
  hub.isConnected = () => true;
  hub.resumeInterrupted();
  await until(() => bin.calls().length >= 1);
  assert.equal(store.data.sessions.r.interrupted, false);
  assert.deepEqual(bin.calls().map(c => c.bin), ["codex"]);
});

test("hub.create refuses an unknown model, an effort the model lacks, and a provider not connected, before anything starts", async () => {
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const { hub, store } = await makeHub(bin);
  const ok = { role: "impl", model: "claude-fable-5-2", effort: "low" };
  await assert.rejects(hub.create({ items: [ok, { role: "impl", model: "gpt-x" }], commonPrompt: "hi", worktree: false }), e => e.status === 400 && /알 수 없는 모델/.test(e.message));
  await assert.rejects(hub.create({ items: [ok, { role: "impl", model: "gpt-fake-codex", perm: "plan", effort: "max" }], commonPrompt: "hi", worktree: false }), e => e.status === 400);
  hub.isConnected = p => p === "claude";
  await assert.rejects(hub.create({ items: [ok, { role: "impl", model: "gemini-3.8-flash-low" }], commonPrompt: "hi", worktree: false }), /Gemini가 Drawing에 연결되지 않았어요/);
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(bin.calls(), []);
  assert.deepEqual(store.data.sessions, {});
});
