// #656: a session started by this Drawing gets its id as DRAWING_SESSION and is told to send it as
// x-drawing-session on workspace API writes, so its cursor is credited for certain.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";

const MODELS = [
  { id: "claude-fable-5-2", provider: "claude", efforts: ["low"], contextWindow: 200000 },
  { id: "gpt-fake-codex", provider: "openai", efforts: ["low"], contextWindow: 272000 },
  { id: "gemini-fake-flash", provider: "gemini", efforts: ["low"], contextWindow: 1000000 },
];
const ROLES = [
  { id: "impl", name: "구현자", model: "claude-fable-5-2", perm: "plan", prompt: "ROLE PROMPT" },
  { id: "codex", name: "구현자", model: "gpt-fake-codex", perm: "plan", prompt: "ROLE PROMPT" },
  { id: "agy", name: "구현자", model: "gemini-fake-flash", perm: "plan", prompt: "ROLE PROMPT" },
];

async function spawned(role) {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-session-env-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  const store = new Store(root);
  await store.load();
  store.save = () => {};
  const seen = [];
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")),
    spawnCli: (bin, args, opts) => { seen.push({ bin, args, env: opts.env }); throw Object.assign(new Error("no CLI in this test"), { code: "ECLIDENIED" }); } });
  after(() => hub.stopAll());
  const [s] = await hub.create({ items: [{ role }], commonPrompt: "hi", worktree: false });
  return { s, seen };
}

test("DRAWING_SESSION is the session id in the CLI env, and the prompt says to send it as x-drawing-session", async () => {
  const { s, seen } = await spawned("impl");
  const call = seen.find((c) => c.bin === "claude");
  assert.ok(call, "claude was spawned");
  assert.equal(call.env.DRAWING_SESSION, s.id);
  const system = call.args[call.args.indexOf("--append-system-prompt") + 1];
  assert.doesNotMatch(system, /x-drawing-session/); // no workspace writes left to credit
});

for (const [role, bin] of [["codex", "codex"], ["agy", "agy"]]) {
  test(`DRAWING_SESSION is the session id in the ${bin} env too`, async () => {
    const { s, seen } = await spawned(role);
    const call = seen.find((c) => c.bin === bin);
    assert.ok(call, `${bin} was spawned`);
    assert.equal(call.env.DRAWING_SESSION, s.id);
  });
}
