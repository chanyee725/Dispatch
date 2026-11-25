import assert from "node:assert/strict";
import { test } from "node:test";
import { accountUsage, codexAccountUsage } from "../../server/dispatch/account-usage.js";
import { geminiUsageResult, resetGeminiUsageCache } from "../../server/dispatch/limits.js";
import { fakeCliBin, fakeSpawner } from "../fixtures/fake-cli/index.mjs";

test("Codex reads only the signed-in account bucket and distinguishes partial, unavailable and failed reads", async t => {
  const read = async payload => {
    const cli = fakeCliBin({ scenarios: { codex: [payload] } });
    t.after(cli.cleanup);
    return codexAccountUsage(fakeSpawner(cli));
  };
  const five = { usedPercent: 0, windowDurationMins: 300, resetsAt: 1900000000 };
  const weekly = { usedPercent: 78, windowDurationMins: 10080, resetsAt: 1900000010 };
  const windows = [
    { label: "5시간", used: 0, reset: 1900000000000 },
    { label: "주간", used: 0.78, reset: 1900000010000 },
  ];
  assert.deepEqual(await read({ rateLimitsByLimitId: { codex: { primary: five, secondary: weekly } },
    rateLimits: { limitId: "another-bucket", primary: weekly } }), { status: "available", windows });
  assert.deepEqual(await read({ rateLimits: { primary: five, secondary: { ...weekly, usedPercent: null } } }),
    { status: "partial", windows: windows.slice(0, 1) });
  assert.deepEqual(await read({ rateLimits: { primary: { usedPercent: 35, resetsAt: "1600000000" } } }),
    { status: "partial", windows: [{ label: null, used: 0.35, reset: null }] });
  assert.deepEqual(await read({ rateLimits: { limitId: "another-bucket", primary: five } }), { status: "unavailable", windows: [] });
  assert.deepEqual(await read({ error: { code: -32601 } }), { status: "unavailable", windows: [] });
  assert.deepEqual(await read({ error: { code: -32603, message: "fixture detail" } }), { status: "error", windows: [] });
});

test("Gemini usage separates a reported weekly limit, partial buckets, no quota and failed lookups", async t => {
  t.after(resetGeminiUsageCache);
  const read = async stdout => {
    resetGeminiUsageCache();
    return geminiUsageResult(async () => ({ stdout }));
  };
  const usage = buckets => JSON.stringify({ status: "SUCCESS", command: { name: "usage", data: {
    groups: [{ name: "Gemini Models", buckets }],
  } } });
  const weekly = { window: "weekly", remaining_fraction: 0.25, reset_time: "2030-01-02T00:00:00Z" };
  const available = await read(usage([weekly]));
  assert.equal(available.status, "available");
  assert.deepEqual(available.windows, [{ label: "주간", used: 0.75, reset: Date.parse(weekly.reset_time) }]);
  const partial = await read(usage([weekly, { window: "fixture", remaining_fraction: 0.5 }, { window: "daily" }]));
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.windows[1], { label: "기간 미확인", used: 0.5, reset: null });
  assert.equal((await read(usage([]))).status, "unavailable");
  assert.equal((await read("invalid JSON")).status, "error");
  assert.equal((await read(JSON.stringify({ status: "ERROR" }))).status, "error");
});

test("account usage respects Dispatch connections and Gemini distinguishes installation from verified account access", async () => {
  const providers = {};
  const ctx = { providers: () => providers, hub: { limits: { five: 0.4, fiveReset: 123, updatedAt: 12 } } };
  const blocked = () => assert.fail("a disconnected provider must not be queried");
  for (const id of ["claude", "openai", "gemini"]) {
    assert.deepEqual(await accountUsage(id, ctx, { codex: blocked, gemini: blocked }),
      { connection: "disconnected", status: null, windows: [] });
    providers[id] = { connected: true };
  }
  assert.deepEqual(await accountUsage("claude", ctx), {
    connection: "connected", status: "partial", windows: [{ label: "5시간", used: 0.4, reset: 123 }], updatedAt: 12,
  });
  providers.openai.method = "API 키";
  assert.deepEqual(await accountUsage("openai", ctx, { codex: blocked }),
    { connection: "connected", status: "unavailable", windows: [], updatedAt: null });
  providers.openai.method = "ChatGPT 계정";
  assert.deepEqual(await accountUsage("openai", ctx, { codex: async () => ({ status: "error", windows: [] }) }),
    { connection: "connected", status: "error", windows: [], updatedAt: null });
  for (const status of ["unavailable", "error"]) {
    assert.deepEqual(await accountUsage("gemini", ctx, { gemini: async () => ({ status, windows: [] }) }),
      { connection: "unverified", status, windows: [], updatedAt: null });
  }
  const windows = [{ label: "주간", used: 0.25, reset: 123 }];
  assert.deepEqual(await accountUsage("gemini", ctx, { gemini: async () => ({ status: "available", windows, updatedAt: 12 }) }),
    { connection: "connected", status: "available", windows, updatedAt: 12 });
  assert.deepEqual(await accountUsage("gemini", ctx, { gemini: async () => {
    delete providers.gemini;
    return { status: "available", windows };
  } }), { connection: "disconnected", status: null, windows: [] });
});

test("account usage retains verified quota signals even when usage rates are unavailable", async () => {
  const hub = { shared: { gemini: { reached: true, reset: 200 } } };
  const ctx = { providers: () => ({ gemini: { connected: true } }), hub };
  const read = now => accountUsage("gemini", ctx, {
    gemini: async () => ({ status: "unavailable", windows: [] }),
    now: () => now,
  });
  assert.deepEqual(await read(100), {
    connection: "unverified", status: "unavailable", windows: [], updatedAt: null, reached: true, reset: 200,
  });
  assert.equal((await read(201)).reached, undefined);
  hub.shared.gemini = { reached: false, reset: null };
  assert.equal((await read(201)).reached, false);
});
