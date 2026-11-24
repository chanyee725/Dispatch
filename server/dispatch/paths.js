// Where Dispatch keeps its own state (issue #782), in one place.
//   <project>/.dispatch/  state.json, drawing.lock, server.port/pid/log, worktrees/<slug>
//   ~/.dispatch/          drawing.json (user defaults), limits.json (shared usage limits)
// Two older layouts are still read:
// - the standalone Dispatch (before 1.0) kept its worktrees in <project>/.dispatch/wt/; a project
//   that still has wt/ (and no worktrees/) keeps using it, nothing is moved.
// - the app was named Atelier before 1.0 and used <project>/.atelier/ and ~/.atelier/. Those are
//   only read, to copy them over once (state-migrate.js); nothing here writes into them.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const STATE_DIR = ".dispatch";
/** The project state folder of the app's Atelier days (read and copied, never written). */
export const LEGACY_STATE_DIR = ".atelier";
export const WORKTREES_DIR = "worktrees";
/** Worktree folder of the standalone Dispatch, inside .dispatch/. */
export const LEGACY_WORKTREES_DIR = "wt";
export const USER_DIR = ".dispatch";
/** ~/.atelier of the app's Atelier days (read once by the copy, never written). */
export const LEGACY_USER_DIR = ".atelier";

/**
 * The files of a project's state folder. `legacy` is a `.atelier/` that is still in use because a
 * saved session runs in one of its worktrees (state-migrate.js). Without it the folder is
 * `.dispatch/`, whose worktrees are in `worktrees/`, or in the standalone Dispatch's `wt/` while
 * that is the only one there.
 */
export function stateLayout(root, { legacy = false } = {}) {
  const dir = path.join(root, legacy ? LEGACY_STATE_DIR : STATE_DIR);
  const oldWt = !legacy && existsSync(path.join(dir, LEGACY_WORKTREES_DIR)) && !existsSync(path.join(dir, WORKTREES_DIR));
  return {
    legacy,
    dir,
    stateFile: path.join(dir, "state.json"),
    lockFile: path.join(dir, "drawing.lock"),
    portFile: path.join(dir, "server.port"),
    worktrees: path.join(dir, oldWt ? LEGACY_WORKTREES_DIR : WORKTREES_DIR),
  };
}

/** ~/.dispatch for this HOME. */
export function userDir(env = process.env) {
  return path.join(env.HOME || os.homedir(), USER_DIR);
}

/** ~/.atelier for this HOME (read once by the copy, never written). */
export function legacyUserDir(env = process.env) {
  return path.join(env.HOME || os.homedir(), LEGACY_USER_DIR);
}
