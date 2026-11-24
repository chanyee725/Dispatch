// Local folder browser (E554, docs/design/local-folder-projects.md): the server machine's folders by name, for
// picking a folder to open as a workspace. Read-only and folder names only: no file names, no file contents, no
// hidden entries (".env", ".git", ...), and symlinks are never followed.
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, parse, resolve, sep } from 'node:path';
import { StoreError } from './errors.js';

// A folder with more sub-folders than this is cut off (the list says so); keeps one response small.
export const MAX_FOLDERS = 2000;
const MAX_PATH = 4096;

// Never forward err.message: it holds absolute paths.
export function fsError(err) {
  switch (err?.code) {
    case 'ENOENT':
      return new StoreError(404, 'folder not found');
    case 'ENOTDIR':
      return new StoreError(400, 'not a folder');
    case 'EACCES':
    case 'EPERM':
      return new StoreError(403, 'no permission to read this folder');
    case 'ENAMETOOLONG':
    case 'ELOOP':
      return new StoreError(400, 'bad path');
    default:
      return err;
  }
}

/** An absolute, normalized path from the query, or the home folder when none is given. Relative paths are refused. */
export function parseFolderPath(raw) {
  if (raw == null || raw === '') return homedir();
  if (typeof raw !== 'string' || raw.length > MAX_PATH || raw.includes('\0') || !isAbsolute(raw)) throw new StoreError(400, 'path must be an absolute folder path');
  return resolve(raw);
}

const hidden = (name) => name.startsWith('.');

/**
 * GET /api/local-folders?path=<abs>: { path, parent, home, root, sep, folders: string[], truncated }.
 * `path` is the real path (symlinks in the request resolved), `parent` is null at the filesystem root.
 */
export async function listLocalFolders(raw) {
  const asked = parseFolderPath(raw);
  let path;
  try {
    path = await realpath(asked);
    if (!(await stat(path)).isDirectory()) throw new StoreError(400, 'not a folder');
  } catch (err) {
    throw fsError(err);
  }
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (err) {
    throw fsError(err);
  }
  // Dirent types come from readdir itself: a symlink is reported as a symlink, so it is skipped without being followed.
  const names = entries.filter((e) => e.isDirectory() && !hidden(e.name)).map((e) => e.name);
  names.sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));
  const parent = dirname(path);
  return {
    path,
    parent: parent === path ? null : parent,
    home: homedir(),
    root: parse(path).root,
    sep,
    folders: names.slice(0, MAX_FOLDERS),
    truncated: names.length > MAX_FOLDERS,
  };
}
