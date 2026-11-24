// Workspace projects: each top-level sub-folder of the workspace is a project that agent sessions can belong to
// (server/dispatch/session-folder.js). `<project>/.project.json` may give it a name, icon and description.
// Folder names only: no files, hidden entries or symlinks are listed, and nothing is written.
import { constants } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const PROJECT_META = '.project.json';
const META_MAX_BYTES = 16 * 1024;
const LIMITS = { name: 100, icon: 16, description: 500 };

/** The optional meta file of a project folder: only known string fields, trimmed and capped; anything else is ignored. */
export async function readProjectMeta(dir) {
  const abs = join(dir, PROJECT_META);
  let fh;
  try {
    // O_NOFOLLOW: a symlinked meta file is refused at open, with no gap between the check and the read.
    // O_NONBLOCK: opening a FIFO must not wait for a writer; it is then rejected by the isFile check.
    fh = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = await fh.stat();
    if (!st.isFile() || st.size > META_MAX_BYTES) return {};
    const raw = JSON.parse(await fh.readFile('utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [k, max] of Object.entries(LIMITS)) {
      const v = typeof raw[k] === 'string' ? raw[k].trim() : '';
      if (v) out[k] = [...v].slice(0, max).join('');
    }
    return out;
  } catch {
    return {};
  } finally {
    await fh?.close().catch(() => {});
  }
}

/**
 * Names of the workspace's top-level sub-folders, sorted. Hidden entries, symlinks, files and `reserved` names
 * (project mode keeps `worktrees` for agent git worktrees, #782) are left out. A missing folder lists nothing.
 */
export async function topFolderNames(root, reserved = []) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.') && !reserved.includes(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

/** GET /api/workspace/projects body: { projects: Project[], loose: [] } (documents are gone, so `docs` stays empty). */
export async function listProjects(root, reserved = []) {
  const projects = [];
  for (const name of await topFolderNames(root, reserved)) {
    const dir = join(root, name);
    let st;
    try {
      st = await stat(dir);
    } catch {
      continue; // gone since the listing
    }
    const meta = await readProjectMeta(dir);
    projects.push({
      path: name,
      name: meta.name ?? name,
      icon: meta.icon ?? null,
      description: meta.description ?? '',
      created: iso(st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs),
      modified: iso(st.mtimeMs),
      count: 0,
      docs: [],
    });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return { projects, loose: [] };
}
