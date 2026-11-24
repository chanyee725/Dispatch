// Only the PR role opens PRs and only the merge role merges them (#1031). For Claude sessions the CLI enforces it
// through --disallowedTools (#1034); the spawn args are read from a stub spawnCli, no CLI runs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { ghPrDenied } from "../../server/dispatch/hub-runners.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";

const MODELS = [{ id: "claude-fable-5-2", provider: "claude", efforts: ["low"], contextWindow: 200000 }];
const ROLES = ["impl", "pr", "merge"].map((id) => ({ id, name: id, model: "claude-fable-5-2", perm: "plan", prompt: "ROLE" }));

async function claudeArgs(role) {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-gh-deny-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  const store = new Store(root);
  await store.load();
  store.save = () => {};
  const seen = [];
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")),
    spawnCli: (bin, args, opts) => { seen.push({ bin, args, env: opts.env }); throw Object.assign(new Error("no CLI in this test"), { code: "ECLIDENIED" }); } });
  after(() => hub.stopAll());
  await hub.create({ items: [{ role }], commonPrompt: "hi", worktree: false });
  const call = seen.find((c) => c.bin === "claude");
  assert.ok(call, "claude was spawned");
  const i = call.args.indexOf("--disallowedTools");
  return i < 0 ? [] : call.args.slice(i + 1).filter((a, k, all) => !all.slice(0, k + 1).some((x) => x.startsWith("--")));
}

test("ghPrDenied: PR create is the PR role's, merge is the merge role's", () => {
  assert.deepEqual(ghPrDenied("impl"), ["Bash(gh pr create:*)", "Bash(gh pr merge:*)"]);
  assert.deepEqual(ghPrDenied("lead"), ["Bash(gh pr create:*)", "Bash(gh pr merge:*)"]);
  assert.deepEqual(ghPrDenied("pr"), ["Bash(gh pr merge:*)"]);
  assert.deepEqual(ghPrDenied("merge"), ["Bash(gh pr create:*)"]);
});

test("Claude sessions get the deny rules of their role on the command line", async () => {
  assert.deepEqual(await claudeArgs("impl"), ["Bash(gh pr create:*)", "Bash(gh pr merge:*)"]);
  assert.deepEqual(await claudeArgs("pr"), ["Bash(gh pr merge:*)"]);
  assert.deepEqual(await claudeArgs("merge"), ["Bash(gh pr create:*)"]);
});
