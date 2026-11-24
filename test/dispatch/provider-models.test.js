// Models and roles as standalone Dispatch offers them (#587): Claude, OpenAI Codex and Gemini, each
// from its own CLI. Replaces the Fable-only rules of E505a (docs/design/fable-only-projects.md, superseded).
import { test } from "node:test";
import assert from "node:assert/strict";
import { codexModels, staticModels } from "../../server/dispatch/models.js";
import { ROLES } from "../../server/dispatch/roles.js";
import { AGENT_CLIS, ALLOWED } from "../../server/dispatch/cli.js";
import { effectiveRoles, patchTeam } from "../../server/dispatch/settings.js";

const CATALOG = { models: [
  { slug: "gpt-b", display_name: "GPT B", visibility: "list", priority: 2, supported_reasoning_levels: [{ effort: "low" }], context_window: 400000 },
  { slug: "gpt-a", visibility: "list", priority: 1, supported_reasoning_levels: [{ effort: "high" }, { effort: "rm -rf" }], default_reasoning_level: "high" },
  { slug: "gpt-hidden", visibility: "hide", priority: 0 },
] };

test("the static list holds Claude and Gemini models and starts no CLI", () => {
  const list = staticModels();
  const ids = list.map(m => m.id);
  for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"]) assert.ok(ids.includes(id), id);
  assert.ok(list.some(m => m.provider === "gemini"));
  assert.equal(list.some(m => m.provider === "openai"), false, "Codex models come from its CLI only");
  for (const m of list.filter(x => x.provider === "claude")) assert.equal(m.contextWindow, 200000);
});

test("codexModels reads `codex debug models`: listed models only, by priority; [] when codex fails", async () => {
  const calls = [];
  const run = async (bin, args) => { calls.push([bin, ...args]); return { stdout: JSON.stringify(CATALOG) }; };
  const list = await codexModels(run);
  assert.deepEqual(calls, [["codex", "debug", "models"]]);
  assert.deepEqual(list.map(m => m.id), ["gpt-a", "gpt-b"]);
  assert.deepEqual(list.map(m => m.provider), ["openai", "openai"]);
  assert.equal(list[0].label, "gpt-a");
  assert.equal(list[0].contextWindow, 272000);
  assert.equal(list[1].contextWindow, 400000);
  assert.deepEqual(await codexModels(async () => { throw new Error("no codex"); }), []);
  assert.deepEqual(await codexModels(async () => ({ stdout: "not json" })), []);
});

test("role defaults: lead/test/design/merge Sonnet, impl/review Opus, docs/pr Haiku; agent CLIs are claude, codex and agy", () => {
  const model = Object.fromEntries(ROLES.map(r => [r.id, r.model]));
  assert.deepEqual(model, { lead: "claude-sonnet-5-5", impl: "claude-opus-5-5", review: "claude-opus-5-5",
    test: "claude-sonnet-5-5", design: "claude-sonnet-5-5", docs: "claude-haiku-5-5",
    pr: "claude-haiku-5-5", merge: "claude-sonnet-5-5" });
  const ids = staticModels().map(m => m.id);
  for (const r of ROLES) assert.ok(ids.includes(r.model), r.id);
  assert.deepEqual(AGENT_CLIS, ["claude", "codex", "agy"]);
  assert.deepEqual([...ALLOWED].sort(), ["agy", "claude", "codex", "gh", "git"]);
});

test("roleModels: any offered model is kept, one not offered (e.g. Codex before it connects) is ignored; patchTeam refuses unknown ones", () => {
  const models = staticModels();
  const store = { data: { settings: { team: { roleModels: { impl: "gemini-3.8-flash-high", review: "gpt-a" } } } }, save() {} };
  const roles = Object.fromEntries(effectiveRoles(ROLES, store, models).map(r => [r.id, r.model]));
  assert.equal(roles.impl, "gemini-3.8-flash-high");
  assert.equal(roles.review, "claude-opus-5-5");
  const withCodex = [...models, { id: "gpt-a", provider: "openai" }];
  assert.equal(effectiveRoles(ROLES, store, withCodex).find(r => r.id === "review").model, "gpt-a");
  assert.throws(() => patchTeam(store, { roleModels: { impl: "gpt-x" } }, { roles: ROLES, models }), e => e.status === 400);
  patchTeam(store, { roleModels: { docs: "claude-fable-5-2" } }, { roles: ROLES, models });
  assert.equal(store.data.settings.team.roleModels.docs, "claude-fable-5-2");
});
