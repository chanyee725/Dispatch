// #819: what agy reports about usage reaches the run records the dashboard's 사용량 tab reads. agy's stream-json gives
// token counts per agent_response step (no cost, no quota share); they add to the session and to the day's per-model
// numbers. No text of the turn goes into the daily record.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";

const MODELS = [{ id: "gemini-fake-flash", provider: "gemini", efforts: ["low"], contextWindow: 1000000 }];
const ROLES = [{ id: "agy", name: "구현자", model: "gemini-fake-flash", perm: "plan", prompt: "ROLE PROMPT" }];

test("a Gemini turn's tokens add to the session and to the day's model usage, numbers only", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "gemini-usage-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  const store = new Store(root);
  await store.load();
  store.save = () => {};
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")),
    spawnCli: () => { throw Object.assign(new Error("no CLI in this test"), { code: "ECLIDENIED" }); } });
  after(() => hub.stopAll());
  const [created] = await hub.create({ items: [{ role: "agy" }], commonPrompt: "hi", worktree: false });
  const s = store.data.sessions[created.id];
  const before = { ...s.usage };
  hub.onGemini(s, { event: "step_update", step_update: { step_type: "agent_response", text_delta: "SECRET REPLY", usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 3 } } });
  hub.onGemini(s, { event: "step_update", step_update: { step_type: "agent_response", text_delta: "more", usage: { input_tokens: 2, output_tokens: 1 } } });
  assert.equal(s.usage.input - before.input, 12);
  assert.equal(s.usage.output - before.output, 6);
  assert.equal(s.usage.cacheRead - before.cacheRead, 3);
  const day = Object.values(store.data.daily).at(-1);
  assert.deepEqual(day.models["gemini-fake-flash"], { input: 12, output: 6, cacheRead: 3, cacheWrite: 0, cost: 0 });
  assert.ok(!JSON.stringify(store.data.daily).includes("SECRET"));
});
