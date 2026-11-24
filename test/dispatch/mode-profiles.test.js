// Harness profiles per mode × role (#748): built-in grid, validation, fallback with a note, and the
// GET/PUT /api/mode-profiles routes writing ~/.atelier/drawing.json. No CLI is started.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staticModels } from "../../server/dispatch/models.js";
import { ROLES } from "../../server/dispatch/roles.js";
import { checkCell, defaultCells, hintFor, MODE_IDS, patchProfiles, profileGrid, readStored, resolveProfile } from "../../server/dispatch/mode-profiles.js";
import { createApp } from "../../server/app.js";
import * as userDefaults from "../../server/user-defaults.js";
import * as workspace from "../../server/workspace/index.js";
import * as dispatch from "../../server/dispatch/index.js";

const CODEX = [{ id: "gpt-a", label: "GPT A", provider: "openai", efforts: ["low", "high"], defaultEffort: "high" }];
const models = [...staticModels(), ...CODEX];
const only = (...ids) => p => ids.includes(p);
const r = (mode, role, o = {}) => resolveProfile({ mode, role, models, isConnected: only("claude", "openai", "gemini"), ...o });

test("modes: plan, impl, review, docs, quickfix, research; every cell of the default grid names a known role", () => {
  assert.deepEqual(MODE_IDS, ["plan", "impl", "review", "docs", "quickfix", "research"]);
  const d = defaultCells();
  for (const m of MODE_IDS) assert.deepEqual(Object.keys(d[m]).sort(), ROLES.map(x => x.id).sort());
});

test("defaults follow model strengths: research Codex, plan Fable, impl Opus, quickfix Opus (#768), docs Sonnet, review cross-checks", () => {
  assert.equal(r("research", "impl").provider, "openai");
  assert.equal(r("research", "impl").model, "gpt-a");
  assert.equal(r("plan", "impl").model, "claude-fable-5-2");
  assert.equal(r("plan", "lead").model, "claude-fable-5-2");
  assert.equal(r("impl", "impl").model, "claude-opus-5-5");
  assert.equal(r("quickfix", "impl").model, "claude-opus-5-5");
  assert.equal(r("quickfix", "impl").effort, null);
  assert.equal(r("docs", "docs").model, "claude-sonnet-5-5");
  // Review differs from the implementer (Opus) when Codex is connected...
  assert.equal(r("impl", "review").model, "gpt-a");
  // ...else Opus, with a note.
  const solo = r("impl", "review", { isConnected: only("claude") });
  assert.equal(solo.model, "claude-opus-5-5");
  assert.match(solo.note, /OpenAI Codex 연결 안 됨/);
  // Research: the implementer is Codex, so the reviewer takes Opus without a note.
  assert.equal(r("research", "review").model, "claude-opus-5-5");
  assert.equal(r("research", "review").note, null);
  assert.equal(r("nope", "impl").mode, "impl", "unknown mode → impl");
  assert.equal(r("impl", "nobody"), null);
});

test("#856 grid: Fable falls back to Opus, the tester cross-checks on Gemini without Codex, the reviewer stays on Opus", () => {
  // Plan/design and hard work: Fable first, Opus when Fable is not offered.
  const noFable = models.filter(m => !m.id.startsWith("claude-fable"));
  for (const role of ["lead", "impl", "design"]) {
    const p = resolveProfile({ mode: "plan", role, models: noFable, isConnected: only("claude") });
    assert.equal(p.model, "claude-opus-5-5", role);
    assert.match(p.note, /claude-fable-5-2 모델 없음/);
  }
  // Research: Codex for the lead and implementer; without Codex the lead takes Sonnet, the implementer Opus.
  assert.equal(r("research", "lead").model, "gpt-a");
  assert.equal(r("research", "lead", { isConnected: only("claude") }).model, "claude-sonnet-5-5");
  // Claude + Gemini, no Codex: the tester differs from the Opus implementer by provider; the reviewer is Opus.
  const cg = only("claude", "gemini");
  assert.equal(r("impl", "test", { isConnected: cg }).model, "gemini-3.8-flash-high");
  assert.equal(r("impl", "review", { isConnected: cg }).model, "claude-opus-5-5");
  // Docs mode: Sonnet writes; quickfix stays one Opus implementer (#768).
  assert.equal(r("docs", "impl").model, "claude-sonnet-5-5");
  assert.equal(r("docs", "docs").model, "claude-sonnet-5-5");
  // Every default cell names its fallbacks, so the 설정 grid can show the chain.
  const d = defaultCells();
  assert.deepEqual(d.plan.impl.fallbacks.map(f => f.model), ["claude-opus-5-5"]);
  assert.deepEqual(d.impl.test.fallbacks.map(f => f.model), ["gemini-3.8-flash-high", "claude-opus-5-5"]);
  assert.equal(d.impl.review.cross, true);
});

test("an unconnected provider falls back to the next choice with a visible note; nothing connected → null", () => {
  const p = r("research", "impl", { isConnected: only("claude") });
  assert.equal(p.model, "claude-opus-5-5");
  assert.equal(p.source, "default");
  assert.match(p.note, /^대신 claude-opus-5-5: OpenAI Codex 연결 안 됨/);
  // A user cell on an unconnected provider falls back to the built-in chain.
  const stored = { cells: { impl: { impl: { provider: "gemini", model: "gemini-3.8-flash-high", effort: null, perm: "auto" } } } };
  assert.equal(r("impl", "impl", { stored }).model, "gemini-3.8-flash-high");
  assert.equal(r("impl", "impl", { stored }).source, "user");
  const fb = r("impl", "impl", { stored, isConnected: only("claude") });
  assert.equal(fb.model, "claude-opus-5-5");
  assert.match(fb.note, /Gemini 연결 안 됨/);
  // The role's 설정 model (roleModels) comes before the built-in preset as the last resort.
  const last = r("research", "lead", { isConnected: only("claude"), stored: {}, roleModel: "claude-haiku-5-5" });
  assert.equal(last.model, "claude-sonnet-5-5");
  assert.equal(r("impl", "impl", { isConnected: () => false }), null);
  // A perm the caller chose wins and skips providers that cannot run it.
  const ae = r("research", "impl", { perm: "acceptEdits" });
  assert.deepEqual([ae.model, ae.perm], ["claude-opus-5-5", "acceptEdits"]);
  assert.match(ae.note, /OpenAI Codex는 acceptEdits 모드를 쓸 수 없음/);
  assert.equal(r("research", "impl", { perm: "plan" }).model, "gpt-a");
});

test("checkCell: provider aliases, model in the list and of that provider, perm rules (Codex plan/auto, agy acceptEdits/auto/plan)", () => {
  assert.deepEqual(checkCell({ provider: "codex", model: "gpt-a", effort: "high", perm: "plan" }, models), { provider: "openai", model: "gpt-a", effort: "high", perm: "plan" });
  assert.equal(checkCell({ provider: "agy", model: "gemini-3.8-flash-low", perm: "acceptEdits" }, models).provider, "gemini");
  assert.equal(checkCell({ provider: "claude", model: "claude-opus-5-5" }, models).perm, "auto");
  const no = (cell, re) => assert.throws(() => checkCell(cell, models), e => e.status === 400 && re.test(e.message));
  no({ provider: "codex", model: "gpt-a", perm: "acceptEdits" }, /acceptEdits/);
  no({ provider: "codex", model: "gpt-a", perm: "manual" }, /manual/);
  no({ provider: "agy", model: "gemini-3.8-flash-low", perm: "manual" }, /manual/);
  no({ provider: "claude", model: "claude-opus-5-5", perm: "bypassPermissions" }, /권한/);
  no({ provider: "claude", model: "gpt-a" }, /모델이 아니에요/);
  no({ provider: "claude", model: "claude-nope" }, /고를 수 없는/);
  no({ provider: "openai", model: "gpt-b" }, /고를 수 없는/);
  no({ provider: "ollama", model: "x" }, /제공사/);
  no({ provider: "claude", model: "claude-opus-5-5", effort: "rm -rf" }, /생각 수준/);
});

test("patchProfiles: set and clear cells and hints, reset a mode or everything; unknown mode/role refused", () => {
  let s = patchProfiles({}, { cells: { review: { review: { provider: "agy", model: "gemini-3.8-flash-high", perm: "plan" } } }, hints: { "gpt-a": "  서치\n잘함  ", gemini: "x".repeat(80) } }, models);
  assert.equal(s.cells.review.review.provider, "gemini");
  assert.equal(s.hints["gpt-a"], "서치 잘함");
  assert.equal(s.hints.gemini.length, 40);
  s = patchProfiles(s, { cells: { plan: { impl: { provider: "claude", model: "claude-opus-5-5" } } } }, models);
  assert.deepEqual(Object.keys(s.cells).sort(), ["plan", "review"]);
  s = patchProfiles(s, { reset: "plan" }, models);
  assert.deepEqual(Object.keys(s.cells), ["review"]);
  s = patchProfiles(s, { cells: { review: { review: null } }, hints: { "gpt-a": "", gemini: null } }, models);
  assert.equal(s, null, "nothing left to store");
  assert.equal(patchProfiles({ cells: { impl: {} }, hints: { openai: "a" } }, { reset: true }, models), null);
  for (const body of [{ cells: { fun: {} } }, { cells: { impl: { boss: {} } } }, { reset: "x" }, { hints: { "claude-nope": "a" } }, { hints: { openai: 3 } }, []])
    assert.throws(() => patchProfiles({}, body, models), e => e.status === 400, JSON.stringify(body));
});

test("readStored keeps only well-formed cells and short hints; hintFor prefers the user's text", () => {
  const s = readStored({ cells: { impl: { impl: { provider: "codex", model: "gpt-a", perm: "bypassPermissions" }, review: "x", boss: {} }, fun: {} }, hints: { "gpt-a": 3, openai: "서치" }, token: "no" });
  assert.deepEqual(s, { cells: { impl: { impl: { provider: "openai", model: "gpt-a", effort: null, perm: "auto" } } }, hints: { openai: "서치" } });
  assert.deepEqual(readStored(null), { cells: {}, hints: {} });
  assert.equal(hintFor(CODEX[0], {}), "서치·자료 수집");
  assert.equal(hintFor(CODEX[0], { "gpt-a": "코드 리뷰" }), "코드 리뷰");
  assert.equal(hintFor(models.find(m => m.id === "claude-fable-5-2")), "복잡한 작업");
  const g = profileGrid({ stored: {}, models, isConnected: only("claude") });
  assert.equal(g.modes.length, 6);
  assert.equal(g.grid.plan.impl.hint, "복잡한 작업");
});

// --- API ---

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "drawing-748-"));
  const root = join(dir, "repo");
  mkdirSync(root);
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "develop");
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "README.md"), "scratch\n");
  git("add", ".");
  git("commit", "-qm", "init");
  const ws = join(root, "ws");
  mkdirSync(ws);
  return { dir, root, ws, file: join(dir, "home", ".atelier", "drawing.json") };
}

test("server: GET/PUT /api/mode-profiles write only changed cells to drawing.json, validate, need x-drawing and reset", async () => {
  const sc = scratch();
  const deps = { limitsFile: join(sc.dir, "limits.json"), providerStatus: async () => ({}), codexModels: async () => [], login: () => {}, logout: async () => {}, cancelLogin: () => {} };
  const moduleList = [
    { name: "userDefaults", setup: ctx => userDefaults.setup(ctx, { file: sc.file }) },
    { name: "workspace", setup: workspace.setup },
    { name: "dispatch", setup: ctx => dispatch.setup(ctx, deps) },
  ];
  const pub = join(sc.dir, "pub");
  mkdirSync(pub);
  writeFileSync(join(pub, "index.html"), "<!doctype html>");
  const app = await createApp({ workspaceDir: sc.ws }, { publicDir: pub, moduleList });
  await new Promise(res => app.server.listen(0, "127.0.0.1", res));
  const base = `http://127.0.0.1:${app.server.address().port}/api/mode-profiles`;
  const W = { "content-type": "application/json", "x-drawing": "1" };
  const put = body => fetch(base, { method: "PUT", headers: W, body: JSON.stringify(body) });
  try {
    const g = await (await fetch(base)).json();
    assert.equal(g.modes.length, 6);
    assert.equal(g.error, null);
    assert.equal(g.grid.impl.impl.resolved, null, "no provider connected yet");
    assert.equal(g.defaults.research.impl.provider, "openai");

    const ok = await put({ cells: { docs: { docs: { provider: "claude", model: "claude-haiku-5-5", effort: "low", perm: "acceptEdits" } } }, hints: { "claude-haiku-5-5": "짧은 문서" } });
    assert.equal(ok.status, 200);
    const saved = JSON.parse(readFileSync(sc.file, "utf8"));
    assert.deepEqual(saved.modeProfiles, { cells: { docs: { docs: { provider: "claude", model: "claude-haiku-5-5", effort: "low", perm: "acceptEdits" } } }, hints: { "claude-haiku-5-5": "짧은 문서" } });
    assert.equal((await ok.json()).grid.docs.docs.cell.model, "claude-haiku-5-5");

    assert.equal((await put({ cells: { impl: { impl: { provider: "claude", model: "claude-opus-5-5", perm: "bypassPermissions" } } } })).status, 400);
    assert.equal((await put({ cells: { impl: { impl: { provider: "codex", model: "gpt-x" } } } })).status, 400, "Codex models only once connected");
    assert.equal((await fetch(base, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" })).status, 403);

    assert.equal((await put({ reset: true })).status, 200);
    assert.equal("modeProfiles" in JSON.parse(readFileSync(sc.file, "utf8")), false);
  } finally {
    await app.close();
    rmSync(sc.dir, { recursive: true, force: true });
  }
});
