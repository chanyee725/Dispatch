// One-time copy of a project's state from the app's Atelier days (`.atelier/`) to `.dispatch/`.
//
// Runs when the Dispatch module starts. `.dispatch/` is the state folder; it is used as it is when
// it already holds state (state.json, worktrees/, or the standalone Dispatch's wt/). Otherwise, when
// `.atelier/state.json` is there, the server holds both project locks (`.atelier/drawing.lock`, so
// no Atelier server works on the folder meanwhile, and `.dispatch/drawing.lock`) and:
// - while a session is saved in `.atelier/state.json` (it runs in `.atelier/worktrees/<slug>` and is
//   resumed from there), keeps using `.atelier/` as it is and tries again on the next start;
// - else copies every entry but the lock, the server's pid/port/log and the worktrees into
//   `.dispatch/`, state.json last, never over a name `.dispatch/` already has.
// `.atelier/` is only read: nothing in it is moved, changed or deleted, so an Atelier checkout still
// finds it as it was. A `.atelier` that is a symlink is never followed.
import { cp, lstat, readdir, readFile } from "node:fs/promises";
import { constants, copyFileSync, linkSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { claimProject } from "./project.js";
import { LEGACY_WORKTREES_DIR, legacyUserDir, stateLayout, userDir, WORKTREES_DIR } from "./paths.js";

const exists = (p) => lstat(p).then(() => true, (e) => (e.code === "ENOENT" ? false : Promise.reject(e)));
/** The lock file and the files lock.js makes beside it belong to the lock, not the state. */
const isLockFile = (name) => name === "drawing.lock" || name.startsWith("drawing.lock.");
/** Never copied: the old server's own run files and its git worktrees (git knows them where they are). */
const NOT_COPIED = new Set(["server.pid", "server.port", "server.log", WORKTREES_DIR]);

/** True when `.dispatch/` already holds state, so nothing is copied into it. */
async function hasState(layout) {
  for (const name of ["state.json", WORKTREES_DIR, LEGACY_WORKTREES_DIR]) if (await exists(path.join(layout.dir, name))) return true;
  return false;
}

/**
 * Copies every entry of `from.dir` but the lock, NOT_COPIED and the names `to.dir` already has into
 * `to.dir`, state.json last. Returns { ok: true, skipped } or { ok: false, why: 'sessions' |
 * 'unreadable' | <error code> }. `from` is never written.
 */
export async function copyState(from, to) {
  let saved = null;
  try {
    saved = JSON.parse(await readFile(from.stateFile, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") return { ok: false, why: "unreadable" };
  }
  if (saved && Object.keys(saved.sessions || {}).length) return { ok: false, why: "sessions" };
  const names = (await readdir(from.dir)).filter((n) => !isLockFile(n) && !NOT_COPIED.has(n));
  // State last, so a half-done copy has no state.json in .dispatch/ and is tried again on the next start.
  names.sort((a, b) => (a === "state.json") - (b === "state.json"));
  const skipped = [];
  try {
    for (const name of names) {
      const dst = path.join(to.dir, name);
      if (await exists(dst)) { skipped.push(name); continue; }
      await cp(path.join(from.dir, name), dst, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    }
  } catch (e) {
    return { ok: false, why: e.code ?? e.name };
  }
  return { ok: true, skipped };
}

/**
 * Claims the project's state folder for this server (project.js claimProject), copying an older
 * `.atelier/` over first when it may. Returns claimProject's refusal, or
 * { ok: true, lock, layout, copied?, kept? } — `layout` is the folder to use (paths.js), `kept` why
 * the `.atelier/` stays in use.
 */
export async function claimState(root) {
  const fresh = stateLayout(root);
  const legacy = stateLayout(root, { legacy: true });
  const st = await lstat(legacy.dir).catch(() => null);
  if (!st?.isDirectory() || (await hasState(fresh)) || !(await exists(legacy.stateFile))) {
    const c = await claimProject(root, fresh);
    return c.ok ? { ...c, layout: fresh } : c;
  }
  const old = await claimProject(root, legacy);
  if (!old.ok) return old;
  const neu = await claimProject(root, fresh);
  if (!neu.ok) {
    await old.lock.release();
    return neu;
  }
  let res;
  try {
    res = await copyState(legacy, fresh);
  } catch (e) {
    res = { ok: false, why: e.code ?? e.name };
  }
  if (res.ok) {
    await old.lock.release();
    const extra = res.skipped.length ? `; already in .dispatch, not copied: ${res.skipped.join(", ")}` : "";
    console.log(`Dispatch state: copied .atelier to .dispatch (.atelier is left as it is${extra})`);
    return { ok: true, lock: neu.lock, layout: stateLayout(root), copied: true };
  }
  await neu.lock.release();
  console.log(`Dispatch state: using .atelier as it is (${res.why}); it is copied to .dispatch on a start with no saved session`);
  return { ok: true, lock: old.lock, layout: legacy, kept: res.why };
}

/** The files of ~/.atelier that Dispatch reads: user defaults, shared limits, the theme. */
export const USER_FILES = ["drawing.json", "limits.json", "prefs.json"];

/** Marks ~/.dispatch as already filled from ~/.atelier, so the copy runs once. */
export const COPIED_MARK = ".copied-from-atelier";

/**
 * Copies USER_FILES from ~/.atelier to ~/.dispatch once (until COPIED_MARK is there), so a file
 * deleted later never comes back. Never overwrites: each file is copied to a temp name and
 * hard-linked into place, which fails when the name exists (the standalone Dispatch's file, another
 * server's copy, or a file Dispatch already wrote). Regular files only, no symlinks; ~/.atelier is
 * left as it is. Off with DRAWING_USER_DEFAULTS=off (tests). Returns what it did.
 */
export function copyUserStateSync(env = process.env) {
  if (env.DRAWING_USER_DEFAULTS === "off") return "off";
  const to = userDir(env);
  const from = legacyUserDir(env);
  const has = (p) => { try { return lstatSync(p); } catch { return null; } };
  const mark = path.join(to, COPIED_MARK);
  if (has(mark)) return "done";
  if (!has(from)?.isDirectory()) return "nothing";
  const files = USER_FILES.filter((f) => has(path.join(from, f))?.isFile());
  if (!files.length) return "nothing";
  try {
    if (has(to) && !has(to).isDirectory()) return "failed";
    mkdirSync(to, { recursive: true, mode: 0o700 });
    let copied = 0;
    for (const f of files) {
      const dst = path.join(to, f);
      const tmp = `${dst}.${process.pid}-${randomUUID()}.tmp`;
      try {
        copyFileSync(path.join(from, f), tmp, constants.COPYFILE_EXCL);
        linkSync(tmp, dst);
        copied++;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      } finally {
        rmSync(tmp, { force: true });
      }
    }
    writeFileSync(mark, "");
    return copied ? "copied" : "done";
  } catch (e) {
    console.error("Dispatch: could not copy ~/.atelier to ~/.dispatch:", e.code ?? e.name);
    return "failed";
  }
}
