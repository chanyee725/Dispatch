#!/usr/bin/env node
// Stop hook (#766): before an agent ends its turn, run only the unit tests that cover what changed
// on this branch (no full npm test, no e2e). A failure exits 2 so the agent keeps working on it.
//
// Changed files: diff against the merge-base with origin/develop (or HEAD) plus untracked files.
// Tests picked: changed test files, and test files that mention a changed source file as
// "<parent dir>/<name>." / "<parent dir>/<name>\"" (how tests import it). test/e2e/ is skipped.
// A passing diff is remembered in tmp so an unchanged branch does not rerun tests every turn,
// and after 3 blocks in a row the hook lets the agent stop (it reports the failure instead).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const MAX_BLOCKS = 3;
const TEST_RE = /\.test\.(m?js|cjs|tsx?)$/;

let input = {};
try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const git = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });

if (git("rev-parse", "--is-inside-work-tree").status) process.exit(0);
const base = ["origin/develop", "HEAD"]
  .map(ref => git("merge-base", "HEAD", ref).stdout.trim())
  .find(Boolean);
if (!base) process.exit(0);

const tracked = git("diff", "--name-only", base).stdout.split("\n");
const untracked = git("ls-files", "--others", "--exclude-standard").stdout.split("\n");
const changed = [...new Set([...tracked, ...untracked])].filter(f => f && existsSync(path.join(root, f)));
if (!changed.length) process.exit(0);

// Fingerprint of the change: the diff text plus untracked file sizes and times.
const stamp = createHash("sha1")
  .update(git("diff", base).stdout)
  .update(untracked.filter(Boolean).map(f => { try { const st = statSync(path.join(root, f)); return `${f}:${st.size}:${st.mtimeMs}`; } catch { return f; } }).join("\n"))
  .digest("hex");
const key = createHash("sha1").update(root).digest("hex").slice(0, 12);
const passFile = path.join(tmpdir(), `atelier-stop-pass-${key}`);
const blockFile = path.join(tmpdir(), `atelier-stop-block-${key}-${String(input.session_id || "x").replace(/[^\w-]/g, "")}`);
if (existsSync(passFile) && readFileSync(passFile, "utf8") === stamp) process.exit(0);

function testFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "e2e" && e.name !== "fixtures" && e.name !== "node_modules") out.push(...testFiles(p)); }
    else if (TEST_RE.test(e.name)) out.push(p);
  }
  return out;
}
const testDir = path.join(root, "test");
const all = existsSync(testDir) ? testFiles(testDir) : [];
const picked = new Set();
for (const f of changed) {
  const abs = path.join(root, f);
  if (TEST_RE.test(f)) { if (all.includes(abs)) picked.add(abs); continue; }
  if (!/\.(m?js|cjs|tsx?)$/.test(f) || f.startsWith("test/")) continue;
  const name = path.basename(f).replace(/\.[^.]+$/, "");
  const ref = `${path.basename(path.dirname(f))}/${name}`;
  for (const t of all) {
    const src = readFileSync(t, "utf8");
    if (src.includes(`${ref}.`) || src.includes(`${ref}"`) || src.includes(`${ref}'`)) picked.add(t);
  }
}
if (!picked.size) { writeFileSync(passFile, stamp); process.exit(0); }

const files = [...picked].map(t => path.relative(root, t));
const envFile = path.join(root, "test", "test-env");
const r = spawnSync(process.execPath, [...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), "--test", "--test-concurrency=4", ...files],
  { cwd: root, encoding: "utf8", timeout: 240_000 });
const out = `${r.stdout || ""}${r.stderr || ""}`;
if (r.status === 0) {
  writeFileSync(passFile, stamp);
  rmSync(blockFile, { force: true });
  process.exit(0);
}

const blocks = (existsSync(blockFile) ? Number(readFileSync(blockFile, "utf8")) || 0 : 0) + 1;
if (blocks > MAX_BLOCKS) {
  rmSync(blockFile, { force: true });
  console.log(JSON.stringify({ systemMessage: `test-changed: tests still fail after ${MAX_BLOCKS} tries; stopping so the failure can be reported.` }));
  process.exit(0);
}
writeFileSync(blockFile, String(blocks));
const lines = out.split("\n");
const failing = lines.filter(l => /^\s*✖|^not ok|^# fail|^ℹ fail/.test(l)).slice(0, 20);
const tail = lines.slice(-30);
process.stderr.write(`Tests covering your changes fail (${files.length} file(s): ${files.join(", ")}). Fix them before ending the turn.\n${failing.join("\n")}\n---\n${tail.join("\n")}\n`);
process.exit(2);
