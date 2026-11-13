import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NOTE, REMIND_MS, expandHome, looksLikeWrite, run, shellSkeleton } from "../../hooks/main-delegates.mjs";

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

test("match -> note, then quiet until REMIND_MS passes, never blocks", () => {
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

test("repeats the note after REMIND_MS, not before", () => {
  const { home, proj, reg, marks } = setup();
  const t0 = Date.now();
  assert.ok(run({}, input(proj), reg, marks, home, t0));
  assert.equal(run({}, input(proj), reg, marks, home, t0 + REMIND_MS - 60_000), null);
  assert.ok(run({}, input(proj), reg, marks, home, t0 + REMIND_MS + 1000));
  // The repeat resets the clock.
  assert.equal(run({}, input(proj), reg, marks, home, t0 + REMIND_MS + 2000), null);
  // An old marker on disk (e.g. from a session hours ago) does not silence the note.
  const mark = join(marks, "dispatch-main-abc-123");
  const old = new Date(Date.now() - 2 * REMIND_MS);
  utimesSync(mark, old, old);
  assert.ok(run({}, input(proj), reg, marks, home));
  assert.equal(readFileSync(mark, "utf8"), "");
});

const bash = (proj, command, sid = "bash-1") => ({ session_id: sid, cwd: proj, tool_name: "Bash", tool_input: { command } });

test("Bash: writes in the project get the note, reads do not", () => {
  const { home, proj, reg, marks } = setup();
  assert.equal(run({}, bash(proj, "git status && ls -la"), reg, marks, home), null);
  assert.equal(run({}, bash(proj, "grep -rn foo src 2>/dev/null"), reg, marks, home), null);
  assert.deepEqual(readdirSync(marks), []);
  assert.ok(run({}, bash(proj, "sed -i 's/a/b/' src/a.js"), reg, marks, home));
  assert.equal(run({}, bash(proj, "sed -i 's/a/b/' src/a.js"), reg, marks, home), null);
  assert.equal(run({}, bash(home, "rm -rf x", "bash-2"), reg, marks, home), null, "outside the project");
  assert.equal(run({}, { session_id: "b3", cwd: proj, tool_name: "Bash", tool_input: {} }, reg, marks, home), null);
});

test("looksLikeWrite: write commands", () => {
  for (const c of [
    "echo hi > out.txt",
    "echo hi >> log.txt",
    "cat > src/a.js <<'EOF'\nconst a = 1;\nEOF",
    "cmd &> all.log",
    "ls 2>&1 > files.txt",
    "sed -i 's/x/y/' a.js",
    "sed -i.bak -e 's/x/y/' a.js",
    "sed --in-place 's/x/y/' a.js",
    "perl -pi -e 's/x/y/' a.js",
    "echo x | tee a.txt",
    "echo x | sudo tee -a /etc/hosts",
    "git commit -m 'msg'",
    "git add -A && git commit -m x",
    "git -C sub apply patch.diff",
    "git checkout -- a.js",
    "git stash",
    "cd src; rm a.js",
    "cp a b",
    "mv a b",
    "mkdir -p x/y",
    "touch x",
    "/bin/rm x",
    "FOO=1 rm x",
    "find . -name '*.tmp' -delete",
    "find . -name '*.tmp' -exec rm {} \\;",
    "ls | xargs rm",
    "python3 -c \"open('a.txt','w').write('x')\"",
    "python3 - <<'EOF'\nfrom pathlib import Path\nPath('a').write_text('x')\nEOF",
    "node -e \"require('fs').writeFileSync('a', 'x')\"",
    "python -c 'import shutil; shutil.rmtree(\"x\")'",
    "(cd src && touch b)",
  ]) assert.equal(looksLikeWrite(c), true, c);
});

test("looksLikeWrite: read-only commands", () => {
  for (const c of [
    "ls -la",
    "cat a.js",
    "grep -rn 'a > b' src",
    "grep -rn \"=>\" src",
    "git status",
    "git log --oneline -5",
    "git diff HEAD~1",
    "git show HEAD",
    "git stash list",
    "git -C sub log",
    "npm test 2>&1",
    "npm test 2>&1 | tail -20",
    "ls >/dev/null 2>&1",
    "ls > /dev/null",
    "cmd 2>/dev/null",
    "cmd &>/dev/null",
    "echo done >&2",
    "sed -n '1,20p' a.js",
    "find . -name '*.js'",
    "python3 -c 'print(1 > 0)'",
    "python3 - <<'EOF'\nprint(1 > 0)\nprint(open('a').read())\nEOF",
    "node -e \"console.log([1].map(x => x))\"",
    "grep writeFileSync src",
    "echo \"rm -rf /\"",
    "",
    "   ",
  ]) assert.equal(looksLikeWrite(c), false, JSON.stringify(c));
  assert.equal(looksLikeWrite(undefined), false);
  assert.equal(looksLikeWrite(42), false);
});

test("shellSkeleton drops quotes, escapes and heredoc bodies", () => {
  assert.equal(shellSkeleton(`echo 'a > b' "c \\" > d" x`), "echo Q Q x");
  assert.equal(shellSkeleton("cat <<EOF > f\nbody > x\nEOF\nls"), "cat <<EOF > f\nls");
  assert.equal(shellSkeleton("echo \\> x"), "echo  x");
});
