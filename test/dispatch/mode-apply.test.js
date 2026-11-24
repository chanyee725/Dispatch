// Team creation uses the harness profile of the mode (#748): create_sessions, plan steps and run records.
// No CLI starts: hub.start is replaced, so nothing is spawned.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";
import { staticModels } from "../../server/dispatch/models.js";
import { ROLES, WRITING } from "../../server/dispatch/roles.js";
import { MODE_IDS, resolveProfile } from "../../server/dispatch/mode-profiles.js";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const MODELS = [...staticModels(), { id: "gpt-a", label: "GPT A", provider: "openai", efforts: ["low", "high"], contextWindow: 272000 }];

async function makeHub(connected, stored = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-748-apply-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")) });
  hub.isConnected = p => connected.includes(p);
  hub.refreshCodex = async () => {};
  hub.start = () => {};
  hub.resolveProfile = async (mode, role, o = {}) => resolveProfile({ mode, role, stored, models: MODELS, isConnected: hub.isConnected, perm: o.perm });
  return { root, store, hub };
}

const make = (hub, items, extra = {}) => hub.create({ items, commonPrompt: "hi", worktree: false, ...extra });

test("a mode picks the profile's model, effort and perm; no mode keeps the role default", async () => {
  const { hub } = await makeHub(["claude", "openai"]);
  const [plain] = await make(hub, [{ role: "docs" }]);
  assert.equal(plain.model, "claude-haiku-5-5");
  assert.equal(plain.mode, undefined);
  const [research] = await make(hub, [{ role: "impl" }], { mode: "research" });
  assert.equal(research.provider, "openai");
  assert.equal(research.model, "gpt-a");
  assert.equal(research.mode, "research");
  const [quick] = await make(hub, [{ role: "impl", mode: "quickfix" }]);
  assert.equal(quick.model, "claude-opus-5-5");
  assert.equal(quick.effort, null);
  // Review cross-checks the implementer (Opus in impl mode).
  const [rev] = await make(hub, [{ role: "review", mode: "impl" }]);
  assert.equal(rev.model, "gpt-a");
});

test("docs mode: Sonnet writes, and every role gets the documents writing style once (#856)", async () => {
  const { hub, store } = await makeHub(["claude"]);
  const [impl] = await make(hub, [{ role: "impl" }], { mode: "docs" });
  assert.equal(impl.model, "claude-sonnet-5-5");
  const count = s => hub.systemPrompt(store.data.sessions[s.id]).split(WRITING).length - 1;
  assert.equal(count(impl), 1);
  const [docs] = await make(hub, [{ role: "docs" }], { mode: "docs" });
  assert.equal(count(docs), 1, "the docs role already has it: not repeated");
  const [plain] = await make(hub, [{ role: "impl" }], { mode: "impl" });
  assert.equal(count(plain), 0);
});

test("a plan step's own model, effort and perm win over the mode's profile", async () => {
  const { hub } = await makeHub(["claude", "openai"]);
  const [s] = await make(hub, [{ role: "impl", mode: "research", model: "claude-opus-5-5", perm: "plan" }]);
  assert.equal(s.model, "claude-opus-5-5");
  assert.equal(s.perm, "plan");
  assert.equal(s.mode, "research");
  const [e] = await make(hub, [{ role: "impl", mode: "quickfix", effort: "high" }]);
  assert.equal(e.model, "claude-opus-5-5");
  assert.equal(e.effort, "high");
  // An item perm Codex cannot run skips Codex in the profile and falls back, with a note, instead of a 400.
  const [ae] = await make(hub, [{ role: "impl", mode: "research", perm: "acceptEdits" }]);
  assert.deepEqual([ae.provider, ae.model, ae.perm], ["claude", "claude-opus-5-5", "acceptEdits"]);
  assert.match(ae.profileNote, /OpenAI Codex는 acceptEdits 모드를 쓸 수 없음/);
  // An explicit Codex model with a perm it cannot run is still refused, never run looser.
  await assert.rejects(make(hub, [{ role: "impl", model: "gpt-a", perm: "acceptEdits" }]), e2 => e2.status === 400);
});

test("an unconnected provider falls back with a note on the session, and in its transcript", async () => {
  const { hub } = await makeHub(["claude"]);
  const [s] = await make(hub, [{ role: "impl" }], { mode: "research" });
  assert.equal(s.model, "claude-opus-5-5");
  assert.match(s.profileNote, /OpenAI Codex 연결 안 됨/);
  assert.ok(hub.transcript(s.id).some(m => m.kind === "system" && /^모드 프로필: /.test(m.text)));
});

test("a user cell from drawing.json is used; an unknown mode is ignored", async () => {
  const stored = { cells: { docs: { docs: { provider: "claude", model: "claude-fable-5-2", effort: "high", perm: "acceptEdits" } } } };
  const { hub, root } = await makeHub(["claude"], stored);
  const [s] = await make(hub, [{ role: "docs", mode: "docs" }]);
  assert.deepEqual([s.model, s.effort, s.perm, s.profileNote], ["claude-fable-5-2", "high", "acceptEdits", undefined]);
  const [u] = await make(hub, [{ role: "docs", mode: "party" }]);
  assert.equal(u.model, "claude-haiku-5-5");
  assert.equal(u.mode, undefined);
  await hub.store.flush();
  const disk = readFileSync(path.join(root, ".atelier", "state.json"), "utf8");
  assert.match(disk, /"mode": ?"docs"/);
});

// The mode list lives in the tool schema only; the lead prompt no longer repeats it (#766 prompt audit).
test("the lead's MCP tools list the six modes", () => {
  const src = readFileSync(new URL("../../server/dispatch/mcp.js", import.meta.url), "utf8");
  for (const id of MODE_IDS) assert.match(src, new RegExp(`id: "${id}"`));
  // #856: with no mode given, the lead picks one from the task; research is named for search work.
  assert.match(src, /주어지지 않으면 과제를 보고 고른다\(웹 서치·자료 조사면 research\)/);
});
