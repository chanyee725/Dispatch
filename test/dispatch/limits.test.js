import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { geminiUsage, geminiUsageWindows, GEMINI_USAGE_MS, mergeLimits, resetGeminiUsageCache, SharedLimits } from "../../server/dispatch/limits.js";

async function tmpFile(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dispatch-limits-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, "limits.json");
}
const claude = (five, updatedAt) => ({ five, seven: 0.1, fiveReset: 1e13, sevenReset: 1e13, updatedAt });

test("mergeLimits: the Claude section with the newer updatedAt wins", () => {
  const a = { claude: claude(0.5, 200) };
  const b = { claude: claude(0.2, 100) };
  const m = mergeLimits(a, b);
  assert.equal(m.claude.five, 0.5);
  assert.deepEqual(mergeLimits(b, a), m);
});

test("mergeLimits: Claude and Gemini sections keep numbers only; keys this server does not know pass through untouched", () => {
  const other = { reached: true, note: "kept as it is" };
  const m = mergeLimits({ claude: { ...claude(0.3, 1), email: "x@y", token: "t" }, gemini: { reached: true, reset: 5, at: 100, account: "a" }, other }, null);
  assert.deepEqual(Object.keys(m.claude).sort(), ["fable", "fableReset", "five", "fiveReset", "seven", "sevenReset", "updatedAt"]);
  assert.deepEqual(m.gemini, { reached: true, reset: 5, at: 100 });
  assert.deepEqual(m.other, other);
});

test("mergeLimits: the Gemini section with the newer `at` wins", () => {
  const a = { gemini: { reached: true, reset: 9, at: 200 } }, b = { gemini: { reached: false, reset: null, at: 100 } };
  assert.equal(mergeLimits(a, b).gemini.reached, true);
  assert.equal(mergeLimits(b, a).gemini.reached, true);
});

test("SharedLimits: a limits.json with a gemini key (written by another server) round-trips through load, write and refresh", async t => {
  const file = await tmpFile(t);
  const gemini = { reached: true, reset: 123, at: 99 };
  await writeFile(file, JSON.stringify({ claude: claude(0.1, 10), gemini, other: [1, 2] }));
  const a = new SharedLimits(file);
  await a.load();
  await a.setClaude(claude(0.4, Date.now()));
  let disk = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(disk.gemini, gemini);
  assert.deepEqual(disk.other, [1, 2]);
  assert.equal(disk.claude.five, 0.4);
  // Another server changes the unknown key; this server picks it up and keeps writing it back.
  await writeFile(file, JSON.stringify({ ...disk, gemini: { ...gemini, reached: false, at: 100 } }));
  await a.refresh();
  await a.setClaude(claude(0.5, Date.now() + 1));
  disk = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(disk.gemini, { ...gemini, reached: false, at: 100 });
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
  await a.setClaude(claude(0.8, Date.now() + 5));
  assert.equal(await b.refresh(), true);
  assert.deepEqual(seen, [0.7, 0.8]);
});

test("SharedLimits: a missing file starts empty and is seeded from the per-project copy", async t => {
  const file = await tmpFile(t);
  const a = new SharedLimits(file);
  await a.load();
  assert.equal(a.claude.five, null);
  assert.equal(await a.refresh(), false);
  await a.load({ claude: claude(0.3, 50) });
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
  const { Hub } = await import("../../server/dispatch/hub.js");
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

  await writeFile(file, JSON.stringify({ claude: claude(0.9, 1000) })); // older value won on disk
  assert.equal(await a.refresh(), false);
  assert.equal(JSON.parse(await readFile(file, "utf8")).claude.updatedAt, 3000);
});

test("Hub: Fable's weekly window shows on its own and keeps its value across other models' turns", async t => {
  const { Hub } = await import("../../server/dispatch/hub.js");
  const file = await tmpFile(t);
  const shared = new SharedLimits(file);
  await shared.load();
  const store = { data: { sessions: {}, settings: { guard: { enabled: true, five: 0.9, seven: 0.85 } } }, save() {} };
  const hub = new Hub({ root: path.dirname(file), store, models: [], roles: [], port: 0, limits: shared });
  const s = { id: "s1", model: "claude-fable-5-2" };
  const next = () => new Promise(r => hub.once("limits", r));
  const event = windows => ({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: windows } });
  const win = (utilization, resetsAt) => ({ utilization, resetsAt, status: "allowed" });
  const far = Math.floor(Date.now() / 1000) + 3600;

  assert.equal((await hub.providerLimits()).fable, null);  // no Fable turn yet

  let done = next();
  hub.onClaude(s, event({ five_hour: win(0.14, far), seven_day: win(0.06, far), seven_day_overage_included: win(0.04, far) }));
  await done;
  let l = await hub.providerLimits();
  assert.deepEqual(l.claude.windows.map(w => w.used), [0.14, 0.06]);
  assert.deepEqual(l.fable, { windows: [{ label: "Fable 주간", used: 0.04, reset: far * 1000 }] });

  done = next();
  hub.onClaude({ id: "s2", model: "claude-fable-5-2" }, event({ five_hour: win(0.2, far), seven_day: win(0.07, far) }));
  await done;
  l = await hub.providerLimits();
  assert.equal(l.claude.windows[0].used, 0.2);
  assert.equal(l.fable.windows[0].used, 0.04);
});

test("SharedLimits: two updates in the same millisecond both land, the later one wins", async t => {
  const file = await tmpFile(t);
  const shared = new SharedLimits(file);
  await shared.load();
  const realNow = Date.now;
  Date.now = () => 5_000_000; // freeze the clock so both calls get the same Date.now()
  try {
    const a = shared.setClaude({ five: 0.14, seven: 0.06 });
    const b = shared.setClaude({ five: 0.2, seven: 0.07 });
    await Promise.all([a, b]);
  } finally { Date.now = realNow; }
  assert.equal(shared.claude.five, 0.2);
  const disk = JSON.parse(await readFile(file, "utf8"));
  assert.equal(disk.claude.five, 0.2);
});

test("Hub guards: guardCheck and limitHit both check five, seven and the Fable weekly window, with the fable ticket key", async t => {
  const { Hub } = await import("../../server/dispatch/hub.js");
  const file = await tmpFile(t);
  // No updatedAt here: setClaude stamps through SharedLimits.stamp(), which stays strictly above the
  // stamp loaded from the file, so each hub's write wins over the previous hub's (#515).
  const mk = async limits => {
    const shared = new SharedLimits(file);
    await shared.load();
    await shared.setClaude({ five: 0.1, seven: 0.1, fiveReset: 1e13, sevenReset: 1e13, ...limits });
    const store = { data: { sessions: {}, settings: { guard: { enabled: true, five: 0.9, seven: 0.85 } } }, save() {} };
    return new Hub({ root: path.dirname(file), store, models: [], roles: [], port: 0, limits: shared });
  };
  const far = Date.now() + 3600_000;
  let hub = await mk({ fable: 0.9, fableReset: far });
  assert.match(hub.guardCheck(1), /Fable 주간 한도 90%/);
  assert.deepEqual(hub.limitHit(), { key: `fable:${far}`, reason: "Fable 주간 한도 90%", resetAt: far });
  hub = await mk({ seven: 0.9, sevenReset: far, fable: 0.1, fableReset: far });
  assert.match(hub.guardCheck(1), /주간 한도 90%/);
  assert.equal(hub.limitHit().key, `seven:${far}`);
  hub = await mk({ fable: 0.5, fableReset: far });
  assert.equal(hub.guardCheck(1), null);
  assert.equal(hub.limitHit(), null);
});

// agy -p /usage --output-format json (#878): the shape agy 1.5 prints, numbers only.
const AGY_USAGE = {
  conversation_id: "", status: "SUCCESS", response: "…", usage: { input_tokens: 0, output_tokens: 0 },
  command: { name: "usage", data: { description: "…", groups: [
    { name: "Gemini Models", buckets: [{ id: "gemini-weekly", name: "Weekly Limit Remaining", window: "weekly", remaining_fraction: 0.25, reset_time: "2026-11-26T10:38:45Z" }] },
    { name: "Claude and GPT models", buckets: [{ id: "3p-weekly", window: "weekly", remaining_fraction: 1, reset_time: "2026-11-26T23:33:22Z" }] },
  ] } },
};

test("geminiUsageWindows: the Gemini group's buckets become windows (used = 1 - remaining), other groups and bad shapes are dropped", () => {
  assert.deepEqual(geminiUsageWindows(JSON.stringify(AGY_USAGE)), [{ label: "주간", used: 0.75, reset: Date.parse("2026-11-26T10:38:45Z") }]);
  const daily = { command: { name: "usage", data: { groups: [{ name: "Gemini Models", buckets: [{ window: "daily", remaining_fraction: 1.2 }, { window: "weekly", remaining_fraction: "x" }] }] } } };
  assert.deepEqual(geminiUsageWindows(daily), [{ label: "일간", used: 0, reset: null }]);
  for (const bad of ["", "not json", "{}", JSON.stringify({ command: { name: "other", data: AGY_USAGE.command.data } })]) assert.deepEqual(geminiUsageWindows(bad), []);
});

test("geminiUsage: one agy /usage run per five minutes (no model turn), failures give null", async t => {
  t.after(resetGeminiUsageCache);
  resetGeminiUsageCache();
  const calls = [];
  const run = async (bin, args) => { calls.push([bin, ...args]); return { stdout: JSON.stringify(AGY_USAGE) }; };
  const [a, b] = await Promise.all([geminiUsage(run, 1000), geminiUsage(run, 1000)]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 5), ["agy", "-p", "/usage", "--output-format", "json"]);
  assert.equal(a.windows[0].used, 0.75);
  assert.equal(b, a);
  await geminiUsage(run, 1000 + GEMINI_USAGE_MS - 1);
  assert.equal(calls.length, 1);
  resetGeminiUsageCache();
  assert.equal(await geminiUsage(async () => { throw new Error("ECLIDENIED"); }, 1), null);
});

test("Hub: providerLimits carries Gemini's /usage windows once Gemini is connected, none before", async t => {
  const { Hub } = await import("../../server/dispatch/hub.js");
  const file = await tmpFile(t);
  const shared = new SharedLimits(file);
  await shared.load();
  const store = { data: { sessions: {}, settings: { guard: { enabled: true, five: 0.9, seven: 0.85 } } }, save() {} };
  const hub = new Hub({ root: path.dirname(file), store, models: [], roles: [], port: 0, limits: shared });
  const windows = [{ label: "주간", used: 0.75, reset: 1e13 }];
  let runs = 0;
  hub.geminiUsage = async () => { runs++; return { windows }; };
  hub.isConnected = p => p === "claude";
  assert.deepEqual((await hub.providerLimits()).gemini, { reached: false, reset: null, windows: [] });
  assert.equal(runs, 0);
  hub.isConnected = () => true;
  assert.deepEqual((await hub.providerLimits()).gemini.windows, windows);
  hub.geminiUsage = async () => { throw new Error("agy failed"); };
  assert.deepEqual((await hub.providerLimits()).gemini.windows, []);
});
