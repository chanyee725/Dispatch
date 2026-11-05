// Run with: node --test server/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { integrationBranch, verifyMerged } from "./git.js";

function scratchRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "dispatch-merge-"));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.name", "Test"); g("config", "user.email", "test@example.invalid");
  writeFileSync(path.join(dir, "a.txt"), "a\n"); g("add", "."); g("commit", "-qm", "init");
  g("branch", "develop");
  g("checkout", "-qb", "feat/x");
  writeFileSync(path.join(dir, "b.txt"), "b\n"); g("add", "."); g("commit", "-qm", "feat");
  g("checkout", "-q", "develop");
  return { dir, g };
}

test("integration branch prefers develop", async () => {
  const { dir } = scratchRepo();
  try { assert.equal(await integrationBranch(dir), "develop"); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unmerged commit fails, merged one passes", async () => {
  const { dir, g } = scratchRepo();
  try {
    const tip = g("rev-parse", "feat/x");
    let r = await verifyMerged(dir, "feat/x");
    assert.equal(r.ok, false);
    assert.equal(r.commit, tip);
    assert.equal(r.base, "develop");
    assert.match(r.reason, /develop에 없어요/);
    g("merge", "-q", "--no-ff", "-m", "merge", "feat/x");
    r = await verifyMerged(dir, tip.slice(0, 7));
    assert.deepEqual({ ok: r.ok, commit: r.commit, reason: r.reason }, { ok: true, commit: tip, reason: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unknown or option-like refs fail without running them", async () => {
  const { dir } = scratchRepo();
  try {
    assert.equal((await verifyMerged(dir, "nope")).ok, false);
    assert.equal((await verifyMerged(dir, "--all")).ok, false);
    assert.equal((await verifyMerged(dir, "")).ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
