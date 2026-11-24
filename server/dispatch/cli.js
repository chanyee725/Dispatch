// The one place that starts child processes (CLAUDE.md): the user's agent CLIs (claude, codex for
// OpenAI Codex, agy for Gemini — the same CLIs standalone Dispatch runs), git and gh. Never through a shell. Everything else in the server imports spawnCli/runCli
// from here; test/dispatch/safety.test.js fails when child_process shows up anywhere else.
//
// Under `node --test` an agent CLI or gh only starts from a fake bin folder (one holding FAKE_MARKER,
// see test/fixtures/fake-cli/), so npm test can never start a real claude, codex, agy or gh (which
// would reach the network) even when one is on PATH.
import { execFile, spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

export const AGENT_CLIS = ["claude", "codex", "agy"];
export const ALLOWED = [...AGENT_CLIS, "git", "gh"];
export const FAKE_MARKER = ".drawing-fake-cli";
// CLIs that must come from a fake bin folder under node --test (git stays local, so it may run).
const FAKE_ONLY_UNDER_TEST = [...AGENT_CLIS, "gh"];

const execFileP = promisify(execFile);

/** Where `bin` resolves on `PATH` (first executable hit), or null. */
export function which(bin, pathVar = process.env.PATH ?? "") {
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, bin);
    try { accessSync(p, constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

const underTest = env => !!(env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT);

function check(bin, opts = {}) {
  if (!ALLOWED.includes(bin)) throw Object.assign(new Error(`not an allowed CLI: ${bin}`), { code: "ECLIDENIED" });
  if (opts.shell) throw Object.assign(new Error("shell is not allowed"), { code: "ECLIDENIED" });
  const env = opts.env ?? process.env;
  if (FAKE_ONLY_UNDER_TEST.includes(bin) && underTest(env)) {
    const hit = which(bin, env.PATH ?? process.env.PATH ?? "");
    if (!hit || !existsSync(path.join(path.dirname(hit), FAKE_MARKER))) {
      throw Object.assign(new Error(`a real ${bin} must not start under npm test`), { code: "ECLIDENIED" });
    }
  }
  return { ...opts, shell: false };
}

/** Starts an allowed CLI; same return value as child_process.spawn. Throws on a bin outside ALLOWED. */
export function spawnCli(bin, args = [], opts = {}) {
  return spawn(bin, args, check(bin, opts));
}

/** Runs an allowed CLI to the end: resolves { stdout, stderr }, rejects like execFile. */
export function runCli(bin, args = [], opts = {}) {
  try { return execFileP(bin, args, check(bin, opts)); } catch (e) { return Promise.reject(e); }
}

// The folder decides the project, not GIT_DIR / GIT_WORK_TREE inherited from whoever started us.
export const GIT_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"];
export const ownGitEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => !GIT_ENV.includes(k)));
