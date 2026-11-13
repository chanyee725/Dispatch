import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NOTE, expandHome, run } from "../../hooks/main-delegates.mjs";

// Fake home with a project folder, a server registry and a marker dir (issue #31).
function setup(pid = process.pid, path = "~/proj") {
  const home = mkdtempSync(join(tmpdir(), "dmd-home-"));
  const proj = join(home, "proj");
  mkdirSync(join(proj, "src"), { recursive: true });
  const reg = join(home, "servers");
  mkdirSync(reg);
  writeFileSync(join(reg, "4317.json"), JSON.stringify({ port: 4317, name: "proj", path, pid, startedAt: 1 }));
  const marks = mkdtempSync(join(tmpdir(), "dmd-marks-"));
  return { home, proj, reg, marks };
}

const input = (proj, extra = {}) => ({ session_id: "abc-123", cwd: proj, tool_input: { file_path: join(proj, "src", "a.js") }, ...extra });

test("does nothing inside a Dispatch session", () => {
  const { home, proj, reg, marks } = setup();
  for (const k of ["DISPATCH_SESSION", "DISPATCH_PARENT", "DISPATCH_SELF"]) {
    assert.equal(run({ [k]: "x" }, input(proj), reg, marks, home), null);
  }
  assert.deepEqual(readdirSync(marks), []);
});

test("no registry -> null", () => {
  const { home, proj, marks } = setup();
  assert.equal(run({}, input(proj), join(home, "missing"), marks, home), null);
});

test("dead pid -> null", () => {
  const { home, proj, reg, marks } = setup(2 ** 30);
  assert.equal(run({}, input(proj), reg, marks, home), null);
});

test("file outside the project -> null", () => {
  const { home, proj, reg, marks } = setup();
  const other = join(home, "proj-other", "a.js");
  assert.equal(run({}, input(proj, { cwd: home, tool_input: { file_path: other } }), reg, marks, home), null);
});

test("match -> note once per session, never blocks", () => {
  const { home, proj, reg, marks } = setup();
  const out = run({}, input(proj), reg, marks, home);
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: NOTE } });
  assert.ok(!("permissionDecision" in out.hookSpecificOutput));
  assert.ok(NOTE.startsWith("[Dispatch 훅]"));
  assert.equal(run({}, input(proj), reg, marks, home), null);
  const files = readdirSync(marks);
  assert.deepEqual(files, ["dispatch-main-abc-123"]);
  assert.equal(readFileSync(join(marks, files[0]), "utf8"), "");
  // A different session gets its own note.
  assert.ok(run({}, input(proj, { session_id: "other" }), reg, marks, home));
});

test("relative file path resolves against cwd; cwd alone counts", () => {
  const { home, proj, reg, marks } = setup();
  assert.ok(run({}, { session_id: "s1", cwd: proj, tool_input: { file_path: "src/a.js" } }, reg, marks, home));
  assert.ok(run({}, { session_id: "s2", cwd: proj, tool_input: {} }, reg, marks, home));
});

test("session id is sanitized in the marker name", () => {
  const { home, proj, reg, marks } = setup();
  assert.ok(run({}, input(proj, { session_id: "../../evil id" }), reg, marks, home));
  assert.deepEqual(readdirSync(marks), ["dispatch-main-______evil_id"]);
});

test("bad input -> null", () => {
  const { home, proj, reg, marks } = setup();
  for (const bad of [null, "x", 42, {}, { session_id: 5, cwd: proj }, { session_id: "s", cwd: "rel" }, { session_id: "s" }]) {
    assert.equal(run({}, bad, reg, marks, home), null);
  }
  writeFileSync(join(reg, "broken.json"), "{not json");
  writeFileSync(join(reg, "nopath.json"), JSON.stringify({ pid: process.pid }));
  assert.ok(run({}, input(proj), reg, marks, home));
  assert.equal(run({}, input(proj, { session_id: "z" }), "\0bad", marks, home), null);
});

test("expandHome expands only the tilde form", () => {
  assert.equal(expandHome("~/x", "/h"), "/h/x");
  assert.equal(expandHome("~", "/h"), "/h");
  assert.equal(expandHome("/abs", "/h"), "/abs");
});
