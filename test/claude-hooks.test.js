// Claude Code hooks in .claude/ (#766): an edit with a syntax error and a change that breaks a test
// both end with exit 2 (the agent is blocked and fixes it); a clean change exits 0.
// Runs the hook scripts against a scratch git repo in a temp dir; no CLI starts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HOOKS = new URL("../.claude/hooks/", import.meta.url).pathname;
const CHECK_EDIT = path.join(HOOKS, "check-edit.mjs");
const TEST_CHANGED = path.join(HOOKS, "test-changed.mjs");

function hook(script, root, input) {
  // NODE_TEST_CONTEXT would make the nested node --test report to this runner instead of exiting.
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [script], { input: JSON.stringify({ cwd: root, session_id: "t", ...input }), env, encoding: "utf8" });
}

function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), "atelier-766-hooks-"));
  const git = (...a) => assert.equal(spawnSync("git", ["-C", root, ...a]).status, 0, a.join(" "));
  git("init", "-q");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  mkdirSync(path.join(root, "lib"));
  mkdirSync(path.join(root, "test"));
  writeFileSync(path.join(root, "lib", "add.js"), "export const add = (a, b) => a + b;\n");
  writeFileSync(path.join(root, "lib", "other.js"), "export const other = 1;\n");
  writeFileSync(path.join(root, "test", "add.test.js"),
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../lib/add.js";\ntest("add", () => assert.equal(add(1, 2), 3));\n');
  git("add", "-A");
  git("commit", "-qm", "init");
  return root;
}

test("check-edit blocks a JS syntax error with exit 2 and passes valid files", () => {
  const root = scratch();
  try {
    const file = path.join(root, "lib", "add.js");
    assert.equal(hook(CHECK_EDIT, root, { tool_input: { file_path: file } }).status, 0);
    writeFileSync(file, "export const add = (a, b) => a + ;\n");
    const r = hook(CHECK_EDIT, root, { tool_input: { file_path: file } });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /lib\/add\.js: check failed/);
    const json = path.join(root, "x.json");
    writeFileSync(json, "{ bad");
    assert.equal(hook(CHECK_EDIT, root, { tool_input: { file_path: json } }).status, 2);
    // Files outside the project are not checked.
    assert.equal(hook(CHECK_EDIT, root, { tool_input: { file_path: CHECK_EDIT } }).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("test-changed blocks a deliberately broken test with exit 2, runs only covering tests, and passes once fixed", () => {
  const root = scratch();
  try {
    // No change: nothing to run.
    assert.equal(hook(TEST_CHANGED, root).status, 0);
    // A change no test covers: passes without running anything.
    writeFileSync(path.join(root, "lib", "other.js"), "export const other = 2;\n");
    assert.equal(hook(TEST_CHANGED, root).status, 0);
    // Break the code add.test.js covers.
    const src = path.join(root, "lib", "add.js");
    writeFileSync(src, "export const add = (a, b) => a - b;\n");
    const r = hook(TEST_CHANGED, root);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /Tests covering your changes fail \(1 file\(s\): test\/add\.test\.js\)/);
    // Fixed: passes.
    writeFileSync(src, "export const add = (a, b) => b + a;\n");
    assert.equal(hook(TEST_CHANGED, root).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("test-changed lets the agent stop after 3 blocks in a row", () => {
  const root = scratch();
  try {
    writeFileSync(path.join(root, "test", "add.test.js"),
      readFileSync(path.join(root, "test", "add.test.js"), "utf8").replace("3)", "4)"));
    for (let i = 0; i < 3; i++) assert.equal(hook(TEST_CHANGED, root, { session_id: "loop" }).status, 2);
    const r = hook(TEST_CHANGED, root, { session_id: "loop" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /still fail after 3 tries/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test(".claude/settings.json wires both hooks, denies .env reads and turns the sandbox on", () => {
  const s = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"));
  assert.ok(s.permissions.deny.includes("Read(./.env)"));
  assert.ok(s.permissions.deny.includes("Read(./.env.*)"));
  assert.ok(s.permissions.deny.includes("Read(~/.ssh/**)"));
  assert.equal(s.sandbox.enabled, true);
  assert.match(s.hooks.PostToolUse[0].hooks[0].command, /check-edit\.mjs/);
  assert.match(s.hooks.Stop[0].hooks[0].command, /test-changed\.mjs/);
});
