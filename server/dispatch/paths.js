// Where Atelier keeps its own state (issue #782), in one place.
//   <project>/.atelier/   state.json, drawing.lock, server.port/pid/log, worktrees/<slug>
//   ~/.atelier/           drawing.json (user defaults), limits.json (shared usage limits)
// Older versions used <project>/.dispatch/ (worktrees in wt/) and ~/.dispatch/. Those are read only
// to move them over once (state-migrate.js); nothing here creates a new .dispatch.
import os from "node:os";
import path from "node:path";

export const STATE_DIR = ".atelier";
export const LEGACY_STATE_DIR = ".dispatch";
export const WORKTREES_DIR = "worktrees";
export const LEGACY_WORKTREES_DIR = "wt";
export const USER_DIR = ".atelier";
export const LEGACY_USER_DIR = ".dispatch";

/**
 * The files of a project's state folder. `legacy` is the not-yet-moved `.dispatch/` of an older
 * version, used as it is until no session needs it any more.
 */
export function stateLayout(root, { legacy = false } = {}) {
  const dir = path.join(root, legacy ? LEGACY_STATE_DIR : STATE_DIR);
  return {
    legacy,
    dir,
    stateFile: path.join(dir, "state.json"),
    lockFile: path.join(dir, "drawing.lock"),
    portFile: path.join(dir, "server.port"),
    worktrees: path.join(dir, legacy ? LEGACY_WORKTREES_DIR : WORKTREES_DIR),
  };
}

/** ~/.atelier for this HOME. */
export function userDir(env = process.env) {
  return path.join(env.HOME || os.homedir(), USER_DIR);
}

/** ~/.dispatch for this HOME (read once by the copy, never written). */
export function legacyUserDir(env = process.env) {
  return path.join(env.HOME || os.homedir(), LEGACY_USER_DIR);
}
