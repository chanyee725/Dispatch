import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergeLimits, SharedLimits } from "../limits.js";

async function tmpFile(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dispatch-limits-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, "limits.json");
}
const claude = (five, updatedAt) => ({ five, seven: 0.1, fiveReset: 1e13, sevenReset: 1e13, updatedAt });

test("mergeLimits: newest updatedAt wins per section", () => {
  const a = { claude: claude(0.5, 200), gemini: { reached: true, reset: 5, at: 100 } };
  const b = { claude: claude(0.2, 100), gemini: { reached: false, reset: null, at: 300 } };
  const m = mergeLimits(a, b);
  assert.equal(m.claude.five, 0.5);
  assert.equal(m.gemini.reached, false);
  assert.deepEqual(mergeLimits(b, a), m);
});

test("mergeLimits: keeps numbers only, drops anything else", () => {
  const m = mergeLimits({ claude: { ...claude(0.3, 1), email: "x@y", token: "t" }, gemini: { reached: true, at: 1, account: "x" } }, null);
  assert.deepEqual(Object.keys(m.claude).sort(), ["five", "fiveReset", "seven", "sevenReset", "updatedAt"]);
  assert.deepEqual(Object.keys(m.gemini).sort(), ["at", "reached", "reset"]);
});

test("SharedLimits: an older write does not overwrite a newer value", async t => {
  const file = await tmpFile(t);
  const a = new SharedLimits(file), b = new SharedLimits(file);
  await a.load(); await b.load();
  await a.setClaude(claude(0.4, 2000));
  await b.setClaude(claude(0.9, 1000));    // b learned an older number
  assert.equal(b.claude.five, 0.4);
  assert.equal(JSON.parse(await readFile(file, "utf8")).claude.five, 0.4);
  assert.deepEqual((await readdir(path.dirname(file))).filter(f => f.endsWith(".tmp")), []);
});

test("SharedLimits: refresh picks up another server's change and emits once", async t => {
  const file = await tmpFile(t);
  const a = new SharedLimits(file), b = new SharedLimits(file);
  await a.load(); await b.load();
  const seen = [];
  b.on("change", d => seen.push(d.claude.five));
  await a.setClaude(claude(0.7, Date.now()));
  assert.equal(await b.refresh(), true);
  assert.equal(await b.refresh(), false);  // nothing new
  await a.setGemini({ reached: true, reset: null });
  assert.equal(await b.refresh(), true);
  assert.equal(b.gemini.reached, true);
  assert.deepEqual(seen, [0.7, 0.7]);
});

test("SharedLimits: a missing file starts empty and is seeded from the per-project copy", async t => {
  const file = await tmpFile(t);
  const a = new SharedLimits(file);
  await a.load();
  assert.equal(a.claude.five, null);
  assert.equal(await a.refresh(), false);
  await a.load({ claude: claude(0.3, 50), gemini: null });
  assert.equal(JSON.parse(await readFile(file, "utf8")).claude.five, 0.3);
  // A second project with an older copy does not roll the shared value back.
  const b = new SharedLimits(file);
  await b.load({ claude: claude(0.1, 10) });
  assert.equal(b.claude.five, 0.3);
});

test("SharedLimits: a damaged file is ignored and replaced on the next write", async t => {
  const file = await tmpFile(t);
  await writeFile(file, "{ not json");
  const a = new SharedLimits(file);
  await a.load();
  assert.equal(a.claude.five, null);
  assert.equal(await a.refresh(), false);
  await a.setClaude(claude(0.2, 5));
  assert.equal(JSON.parse(await readFile(file, "utf8")).claude.five, 0.2);
});

test("Hub: a fresh server reads the shared value, and another server's change reaches guard and events", async t => {
  const { Hub } = await import("../sessions.js");
  const file = await tmpFile(t);
  const other = new SharedLimits(file);
  await other.setClaude(claude(0.95, Date.now()));     // written by another project's server

  const shared = new SharedLimits(file);
  await shared.load();
  const store = { data: { sessions: {}, settings: { guard: { enabled: true, five: 0.9, seven: 0.85 } } }, save() {} };
  const hub = new Hub({ root: path.dirname(file), store, models: [], roles: [], port: 0, limits: shared });
  assert.match(hub.guardCheck(1), /5시간 한도 95%/);  // before any Claude turn here
  assert.equal(hub.limitHit().reason, "5시간 한도 95%");

  const events = [];
  hub.on("limits", l => events.push(l.five));
  await other.setClaude(claude(0.2, Date.now() + 1));
  await shared.refresh();
  assert.deepEqual(events, [0.2]);
  assert.equal(hub.guardCheck(1), null);
  assert.equal((await hub.providerLimits()).claude.windows[0].used, 0.2);
});

test("SharedLimits: concurrent writes from two servers always leave the newest value", async t => {
  const file = await tmpFile(t);
  for (let i = 0; i < 200; i++) {
    await rm(file, { force: true });
    const a = new SharedLimits(file), b = new SharedLimits(file);
    await Promise.all([a.setClaude(claude(0.2, 2000 + i * 10)), b.setClaude(claude(0.9, 1000 + i * 10))]);
    assert.equal(JSON.parse(await readFile(file, "utf8")).claude.updatedAt, 2000 + i * 10, `run ${i}`);
  }
  assert.deepEqual((await readdir(path.dirname(file))).filter(f => f !== "limits.json"), []);
});

test("SharedLimits: a stale lock is taken over, and refresh repairs a file that lost a race", async t => {
  const file = await tmpFile(t);
  const a = new SharedLimits(file);
  await writeFile(file + ".lock", "");
  const { utimes } = await import("node:fs/promises");
  const old = new Date(Date.now() - 60_000);
  await utimes(file + ".lock", old, old);
  await a.setClaude(claude(0.4, 3000));
  assert.equal(JSON.parse(await readFile(file, "utf8")).claude.five, 0.4);

  await writeFile(file, JSON.stringify({ claude: claude(0.9, 1000), gemini: null })); // older value won on disk
  assert.equal(await a.refresh(), false);
  assert.equal(JSON.parse(await readFile(file, "utf8")).claude.updatedAt, 3000);
});
