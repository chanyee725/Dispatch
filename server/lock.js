// One-server locks (E13): a small JSON file { pid, port } that says which server owns a folder.
// `<workspace>/.drawing/server.lock` keeps two Atelier servers off one workspace;
// `<project>/.atelier/drawing.lock` keeps two Dispatch modules off one project's state (server/dispatch/paths.js).
// A lock whose owner is gone (dead pid, or its port no longer answers as that server) is stale and
// gets replaced, so a crash never blocks the next start.
import { readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';

const HOST = '127.0.0.1';

/** True when a process with this pid exists (EPERM: it exists but belongs to someone else). */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** GET http://127.0.0.1:<port><path> as JSON, or null when nothing answers in time. Loopback only. */
export async function probe(port, path, timeoutMs = 800) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  try {
    const res = await fetch(`http://${HOST}:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** { raw, holder } for the lock at file; raw is null when there is no file, holder null when it is not ours to parse. */
async function readLock(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return { raw: null, holder: null };
  }
  try {
    const h = JSON.parse(raw);
    return { raw, holder: h && typeof h === 'object' ? { pid: h.pid, port: h.port ?? null } : null };
  } catch {
    return { raw, holder: null };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Removes the lock at `file` only if it still reads `raw` (the content judged stale). Removal runs
 * under `<file>.break`, so two servers replacing the same stale lock cannot have the slower one
 * delete the lock the faster one just took. Right before the rm we check `.break` still names us
 * (#205): if we were cleared as dead meanwhile, someone else may be inside, so we delete nothing and
 * claimLock's next attempt starts over. This narrows the race window, it does not close it: we can
 * still be cleared between that check and the rm.
 */
async function removeIfUnchanged(file, raw) {
  const release = await acquireBreak(`${file}.break`);
  try {
    if ((await release.held()) && (await readLock(file)).raw === raw) await rm(file, { force: true });
  } finally {
    await release();
  }
}

export class LockBreakTimeoutError extends Error {
  name = 'LockBreakTimeoutError';
}

const OWNER_NAME = /^(\d+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ownerPid = (name) => Number.parseInt(name, 10);

/**
 * Takes the mutex `brk` and returns its async release(); release.held() is true while `brk` still
 * holds our owner file (false once we were judged dead and cleared). The mutex is a folder holding one file
 * named after its owner (`<pid>-<uuid>`). It is made as `<brk>.<owner>.tmp/<owner>` and renamed
 * into place: rename onto a missing or empty folder succeeds, onto a held one (never empty) fails.
 *
 * A holder judged dead is cleared by unlinking its own file name and then removing the folder only
 * while empty. Both steps act on that holder alone, so a waiter that judged a holder dead and acts
 * late (after someone else cleared it and took the mutex) finds the name gone and touches nothing;
 * a new owner renamed onto the emptied folder makes the rmdir fail. #161 moved the whole `.break`
 * aside instead, which with 3+ waiters could move a live holder's break and let two in (#199).
 * `owner`, `isDead` and `tries` are for tests; isDead(name) defaults to "its pid is not running".
 */
export async function acquireBreak(brk, { owner = `${process.pid}-${randomUUID()}`, isDead, tries = 200 } = {}) {
  // Only `<pid>-<uuid>` names are owners; any other name is not ours to judge or remove.
  const dead = isDead ?? (async (name) => OWNER_NAME.test(name) && !pidAlive(ownerPid(name)));
  const stage = `${brk}.${owner}.tmp`;
  await sweepStages(brk);
  for (let i = 0; i < tries; i++) {
    await rm(stage, { recursive: true, force: true });
    await mkdir(stage);
    await writeFile(join(stage, owner), '', { flag: 'wx' });
    try {
      await rename(stage, brk);
      const release = () => releaseBreak(brk, owner);
      release.held = () => holdsBreak(brk, owner);
      return release;
    } catch (err) {
      if (!['ENOTEMPTY', 'EEXIST', 'ENOTDIR', 'EISDIR'].includes(err.code)) throw err;
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
    if (!(await clearDeadBreak(brk, dead))) await sleep(10);
  }
  throw new LockBreakTimeoutError('lock break timed out');
}

/** Removes staging folders `<brk>.<pid>-<uuid>.tmp` left by a process that died between mkdir and rename. */
async function sweepStages(brk) {
  const prefix = `${basename(brk)}.`;
  let names;
  try {
    names = await readdir(dirname(brk));
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
    const owner = name.slice(prefix.length, -'.tmp'.length);
    if (!OWNER_NAME.test(owner) || pidAlive(ownerPid(owner))) continue;
    await rm(join(dirname(brk), name), { recursive: true, force: true }).catch(() => {});
  }
}

/** True when `brk` is a real folder that holds `owner`'s file. lstat: a link planted at either name is not ours. */
async function holdsBreak(brk, owner) {
  try {
    if (!(await lstat(brk)).isDirectory()) return false;
    return (await lstat(join(brk, owner))).isFile();
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
    throw err;
  }
}

/**
 * Clears `brk` when its holder is dead; true when something was cleared (retry at once). Exported
 * for tests. Only names `dead(name)` judges dead are unlinked and the folder is removed only while
 * empty, so a live holder's `.break` is never moved or removed (#205).
 */
export async function clearDeadBreak(brk, dead) {
  let names;
  try {
    // A link at `.break` (planted or stray) is never followed: readdir/unlink would act on its target.
    if ((await lstat(brk)).isSymbolicLink()) {
      await unlink(brk).catch((err) => {
        if (err.code !== 'ENOENT') throw err;
      });
      return true;
    }
    names = await readdir(brk);
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    if (err.code === 'ENOTDIR') return clearOldBreakFile(brk);
    throw err;
  }
  let cleared = names.length === 0; // emptied by a release or a clear; the next rename replaces it
  for (const name of names) {
    if (!(await dead(name))) continue;
    try {
      await unlink(join(brk, name)); // ENOENT: someone else cleared this holder already
      cleared = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  if (cleared) await rmdir(brk).catch(() => {}); // ENOTEMPTY: a new owner already took it
  return cleared;
}

/** A `.break` file left by a server from before #199: cleared only when its pid is gone. */
async function clearOldBreakFile(brk) {
  const { holder } = await readLock(brk);
  if (holder && pidAlive(holder.pid)) return false;
  try {
    await rm(brk, { force: true });
  } catch (err) {
    // Another server cleared the file and a third made it a folder meanwhile: retry from the top.
    if (err.code !== 'ERR_FS_EISDIR' && err.code !== 'EISDIR') throw err;
  }
  return true;
}

/** Unlinks our own owner file only (so it never acts on a `.break` that no longer names us), then the folder while empty. */
async function releaseBreak(brk, owner) {
  try {
    await unlink(join(brk, owner));
  } catch (err) {
    if (err.code === 'ENOENT') return; // judged dead and cleared: the folder is not ours any more
    throw err;
  }
  await rmdir(brk).catch(() => {}); // ENOTEMPTY: the next owner already took it
}

export class LockPathError extends Error {
  name = 'LockPathError';
}

/** Writes a fresh temp file; `wx` never follows a link planted at that name. */
async function writeTemp(tmp, body) {
  await rm(tmp, { force: true });
  await writeFile(tmp, JSON.stringify(body), { flag: 'wx' });
}

/**
 * Makes sure `dir` (created when missing) is a real folder inside `root`: no symlink at `dir` or on
 * the way from `root`, so a committed link like `.drawing -> /elsewhere` cannot move our writes out.
 */
export async function ensureDirInside(root, dir) {
  const realRoot = await realpath(root);
  const rel = relative(root, dir);
  if (!rel || rel.startsWith('..') || rel.startsWith(sep)) throw new LockPathError('lock folder outside its root');
  let cur = root;
  for (const seg of rel.split(sep)) {
    cur = join(cur, seg);
    try {
      if (!(await lstat(cur)).isDirectory()) throw new LockPathError('lock folder is a symlink or not a folder');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await mkdir(cur);
    }
  }
  const real = await realpath(dir);
  if (real !== join(realRoot, rel)) throw new LockPathError('lock folder outside its root');
}

/**
 * Takes the lock at `file`, or reports who holds it. With `root`, the lock's folder must be a real
 * folder inside root (LockPathError otherwise).
 * `isLive(holder)` decides whether an existing holder { pid, port } still runs; a holder that is not
 * live is removed and the lock taken. Returns { ok: true, lock } or { ok: false, holder }.
 * lock.setPort(port) records the port once the server listens; lock.release() / releaseSync()
 * remove the file only while it is still ours.
 */
export async function claimLock(file, { isLive, root }) {
  if (root) await ensureDirInside(root, dirname(file));
  else await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  for (let attempt = 0; attempt < 5; attempt++) {
    // Write a temp file, then hard-link it into place: link fails with EEXIST if someone holds the
    // lock, and readers never see a half-written file.
    await writeTemp(tmp, { pid: process.pid, port: null });
    try {
      await link(tmp, file);
      return { ok: true, lock: ownLock(file) };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    } finally {
      await rm(tmp, { force: true });
    }
    const { raw, holder } = await readLock(file);
    if (raw === null) continue; // released meanwhile
    if (holder && holder.pid !== process.pid && (await isLive(holder))) return { ok: false, holder };
    await removeIfUnchanged(file, raw);
  }
  return { ok: false, holder: (await readLock(file)).holder };
}

function ownLock(file) {
  const ours = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')).pid === process.pid;
    } catch {
      return false;
    }
  };
  return {
    file,
    async setPort(port) {
      if (!ours()) return;
      const tmp = `${file}.${process.pid}.tmp`;
      await writeTemp(tmp, { pid: process.pid, port });
      await rename(tmp, file);
    },
    async release() {
      if (ours()) await rm(file, { force: true });
    },
    releaseSync() {
      try {
        if (ours()) unlinkSync(file);
      } catch {
        /* already gone */
      }
    },
  };
}

/** Lock for one workspace folder: another Atelier server is live if its pid runs and its port
 *  (once known) answers /api/info with this workspace's folder name. */
export function claimWorkspace(workspaceDir) {
  const name = basename(workspaceDir);
  return claimLock(join(workspaceDir, '.drawing', 'server.lock'), {
    root: workspaceDir,
    isLive: async ({ pid, port }) => {
      if (!pidAlive(pid)) return false;
      if (port == null) return true; // still starting
      return (await probe(port, '/api/info'))?.workspace === name;
    },
  });
}
