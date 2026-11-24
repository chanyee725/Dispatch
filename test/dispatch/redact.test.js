// Key- and email-shaped text is masked before it reaches memory, the UI or disk, and state.json
// keeps metadata only (no prompt, CLI error, task note or ticket item note).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MASK, redact, redactDeep } from "../../server/dispatch/redact.js";
import { Hub } from "../../server/dispatch/hub.js";
import { diskView, Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";
import { fakeCliBin, fakeSpawner, until } from "../fixtures/fake-cli/index.mjs";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// Built from parts so this file holds no key-shaped literal of its own.
const KEY = ["sk", "ant", "api03", "x".repeat(24)].join("-");
const GH = "ghp_" + "a1".repeat(15);
const MAIL = ["someone", "example.com"].join("@");

test("redact masks emails, provider keys, JWTs and secret assignments", () => {
  const cases = [
    [`write to ${MAIL} please`, `write to ${MASK} please`],
    [`key ${KEY} end`, `key ${MASK} end`],
    [`token ${GH}`, `token ${MASK}`],
    ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345", `Authorization: Bearer ${MASK}`],
    ['api_key="abcd1234efgh5678"', `api_key="${MASK}"`],
    [`${"AKIA"}ABCDEFGHIJKLMNOP`, MASK],
    [`eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop`, MASK],
  ];
  for (const [input, want] of cases) assert.equal(redact(input), want, input);
});

test("redact leaves ordinary agent output alone", () => {
  for (const t of ["npm test -- auth.spec.ts:42", "git push origin HEAD:feat/x", "git@github.com:owner/repo.git",
    "see src/a.ts@main", "token: 1234", "commit 8b05c02 on develop", "@types/node 22", ""]) {
    assert.equal(redact(t), t, t);
  }
  assert.equal(redact(null), null);
  assert.equal(redact(42), 42);
});

const MODELS = [{ id: "claude-fable-5-2", provider: "claude", efforts: ["low"], contextWindow: 200000 }];
const ROLES = [{ id: "impl", name: "구현자", model: "claude-fable-5-2", perm: "plan", prompt: "ROLE PROMPT" }];

async function makeHub() {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-redact-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  store.save = () => {}; // no delayed write into a folder the test removes; the test flushes itself
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")),
    spawnCli: () => { throw Object.assign(new Error("no CLI in this test"), { code: "ECLIDENIED" }); } });
  const s = { id: "s1", n: 1, name: "Juno", role: "impl", provider: "claude", model: "claude-fable-5-2", effort: null, perm: "plan",
    prompt: `custom prompt for ${MAIL}`, canSpawn: false, cwd: root, status: "idle", startedAt: 0, updatedAt: 0, last: "", turns: 0,
    ctx: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, providerSessionId: null, error: null };
  store.data.sessions[s.id] = s;
  return { root, store, hub, s };
}

test("the transcript ring buffer, errors and the task board get masked text", async () => {
  const { hub, s } = await makeHub();
  hub.push(s, { kind: "assistant", text: `my key is ${KEY}` });
  assert.equal(hub.transcript("s1").at(-1).text, `my key is ${MASK}`);
  hub.touch(s, { status: "error", error: `auth failed for ${MAIL}`, last: `ping ${MAIL}` });
  assert.equal(s.error, `auth failed for ${MASK}`);
  assert.equal(s.last, `ping ${MASK}`);
  const t = await hub.setTask("s1", { title: `mail ${MAIL}`, note: `uses ${GH}` });
  assert.equal(t.title, `mail ${MASK}`);
  assert.equal(t.note, `uses ${MASK}`);
});

test("state.json drops the question a reply ends with (ask) but memory keeps it", async () => {
  const { root, store, s } = await makeHub();
  s.asksUser = true;
  s.ask = "Which branch should the secret question use?";
  const view = diskView(store.data);
  assert.equal("ask" in view.sessions.s1, false);
  assert.equal(view.sessions.s1.asksUser, true);
  assert.equal(store.data.sessions.s1.ask, "Which branch should the secret question use?");

  await store.flush();
  const disk = readFileSync(path.join(root, ".atelier", "state.json"), "utf8");
  assert.doesNotMatch(disk, /secret question/);
});

test("state.json drops prompt, error, task notes and ticket item notes", async () => {
  const { root, store, hub, s } = await makeHub();
  s.error = "CLI said something";
  await hub.setTask("s1", { title: "build page", note: "secret note" });
  store.data.tickets = { k: { id: "k", lead: "s1", status: "open", items: [{ title: "build page", stage: "impl", owner: "Juno", note: "secret item note" }] } };
  const view = diskView(store.data);
  assert.equal("prompt" in view.sessions.s1, false);
  assert.equal("error" in view.sessions.s1, false);
  assert.equal(Object.values(view.tasks).every(t => !("note" in t)), true);
  assert.deepEqual(view.tickets.k.items, [{ title: "build page", stage: "impl", owner: "Juno" }]);
  // Memory keeps them.
  assert.equal(Object.values(store.data.tasks)[0].note, "secret note");
  assert.equal(store.data.tickets.k.items[0].note, "secret item note");

  await store.flush();
  const disk = readFileSync(path.join(root, ".atelier", "state.json"), "utf8");
  assert.doesNotMatch(disk, /secret|custom prompt|CLI said/);

  // After a restart the role prompt is read from the role, and the missing fields have defaults.
  const again = new Store(root);
  await again.load();
  again.save = () => {}; // Hub's constructor saves new cursor colours; a delayed write would hit the removed folder
  assert.equal(again.data.sessions.s1.error, null);
  assert.equal(Object.values(again.data.tasks)[0].note, "");
  const hub2 = new Hub({ root, store: again, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")) });
  assert.match(hub2.systemPrompt(again.data.sessions.s1), /^ROLE PROMPT/);
});

test("a CLI that leaks a key and an email: masked in memory, absent from disk", async () => {
  const leakKey = ["sk", "test", "FAKE0000"].join("-");
  const leakMail = ["someone", "example.invalid"].join("@");
  const bin = fakeCliBin({ scenario: [
    { type: "system", subtype: "init", session_id: "fake-claude-session" },
    { type: "assistant", message: { id: "m1", content: [{ type: "text", text: `found ${leakKey} for ${leakMail}` }], usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: `echo ${leakKey}` } }] } },
    { type: "result", subtype: "error", is_error: true, result: `auth failed for ${leakMail}`, total_cost_usd: 0 },
  ] });
  dirs.push(bin.dir);
  const root = mkdtempSync(path.join(tmpdir(), "drawing-redact-leak-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  store.save = () => {};
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")), spawnCli: fakeSpawner(bin) });
  after(() => hub.stopAll());
  const [pub] = await hub.create({ items: [{ role: "impl" }], commonPrompt: `say hi to ${leakMail}`, worktree: false });
  await until(() => hub.transcript(pub.id).some(e => e.kind === "tool"));
  await new Promise(r => setTimeout(r, 100));
  const s = store.data.sessions[pub.id];
  const memory = JSON.stringify({ transcript: hub.transcript(pub.id), session: hub.publicSession(s), tasks: hub.tasks });
  assert.doesNotMatch(memory, /FAKE0000|example\.invalid/);
  assert.match(memory, /\[가림\]/);

  await store.flush();
  const files = [];
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } };
  walk(root); // the whole workspace, not only .dispatch
  assert.ok(files.length > 0);
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), /FAKE0000|example\.invalid|found \S+ for|auth failed|echo /, f); // also the surrounding transcript text
  assert.equal(existsSync(path.join(root, ".atelier", "transcripts")), false);
});

test("permission requests reach the UI masked, while the allow answer keeps the raw input", async () => {
  const { hub, s } = await makeHub();
  const raw = { command: `curl -H "Authorization: Bearer ${"a".repeat(24)}" ${MAIL}`, nested: [{ k: KEY }] };
  hub.rt(s.id).perms.set("r1", { requestId: "r1", tool: "Bash", input: raw, description: `mail ${MAIL}`, suggestions: [{ rule: GH }] });
  const shown = JSON.stringify(hub.publicSession(s).pending);
  assert.doesNotMatch(shown, /example\.com|ghp_|sk-ant|aaaaaaaa/);
  assert.match(shown, /\[가림\]/);
  assert.equal(hub.rt(s.id).perms.get("r1").input, raw);
});

test("an allow response writes the original input and suggestions to the CLI stdin", async () => {
  const { hub, s } = await makeHub();
  const raw = { command: `curl ${MAIL}`, nested: [{ k: KEY }] };
  const written = [];
  const r = hub.rt(s.id);
  r.proc = { stdin: { write: line => written.push(line) } };
  r.perms.set("r1", { requestId: "r1", tool: "Bash", input: raw, description: "d", suggestions: [{ rule: GH }] });
  hub.respondPermission(s.id, "r1", "allow", true);
  assert.equal(written.length, 1);
  const { response } = JSON.parse(written[0]).response;
  assert.equal(response.behavior, "allow");
  assert.deepEqual(response.updatedInput, raw);
  assert.deepEqual(response.updatedPermissions, [{ rule: GH }]);
  assert.doesNotMatch(written[0], /\[가림\]/);
});

test("limit tickets get a masked leadLast", async () => {
  const { hub, s } = await makeHub();
  s.canSpawn = true;
  hub.rt(s.id).lastText = `report for ${MAIL} with ${KEY}`;
  (hub.store.data.tasks ||= {}).t1 = { id: "t1", title: "x", stage: "doing", lead: s.id, createdAt: 0, updatedAt: 0 };
  hub.limitHit = () => ({ key: "five:1", reason: "5시간 한도 90%", resetAt: Date.now() + 1000 });
  hub.interrupt = () => {};
  hub.checkTickets();
  const [t] = Object.values(hub.store.data.tickets);
  assert.match(t.leadLast, /\[가림\]/);
  assert.doesNotMatch(t.leadLast, /example\.com|sk-ant/);
});

test("redactDeep masks string values but leaves object keys alone (documented)", () => {
  const out = redactDeep({ [MAIL]: `mail ${MAIL}`, list: [KEY] });
  assert.deepEqual(Object.keys(out), [MAIL, "list"]);
  assert.equal(out[MAIL], `mail ${MASK}`);
  assert.deepEqual(out.list, [MASK]);
});
