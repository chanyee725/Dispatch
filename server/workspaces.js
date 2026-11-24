// Workspace folders (E554, issue #721; docs/design/local-folder-projects.md): the folders the user opened as
// workspaces, and switching this one server between them without a restart. Each folder keeps its own
// <folder>/.drawing/ data; agent sessions run in the git project that holds the open folder.
//
// The list and the last-opened folder live in ~/.atelier/drawing.json (`workspaces`, `lastWorkspace`, E555),
// written only through UserDefaults.update. Metadata only: a path and a folder name, nothing else.
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, parse, relative, sep } from 'node:path';
import { expandHome } from './user-defaults.js';
import { fsError, parseFolderPath } from './workspace/local-folders.js';

export class WorkspaceError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** `~/x` for a path under HOME (keeps the user name out of drawing.json), the path itself otherwise. */
export function tildePath(p, home = homedir()) {
  if (p === home) return '~';
  const r = relative(home, p);
  return r && !r.startsWith('..') && !isAbsolute(r) ? `~/${r.split(sep).join('/')}` : p;
}

/** The absolute path a stored entry names (`~/…` resolved against HOME). */
const absolute = (p) => expandHome(p, { HOME: homedir() });

/**
 * The real path of a folder the user may open as a workspace. Refuses a missing path or a file (404/400), the
 * filesystem root and the home folder itself (both far too large to watch; a workspace gets a .drawing/ folder).
 */
export async function checkFolder(raw) {
  if (typeof raw !== 'string' || raw === '') throw new WorkspaceError(400, 'path is required', 'bad_path');
  let dir;
  try {
    dir = await realpath(parseFolderPath(raw));
    if (!(await stat(dir)).isDirectory()) throw Object.assign(new Error(), { code: 'ENOTDIR' });
  } catch (err) {
    const e = err?.status ? err : fsError(err);
    if (e?.status) throw new WorkspaceError(e.status, e.message, e.status === 404 ? 'not_found' : e.status === 403 ? 'no_permission' : 'bad_path');
    throw err;
  }
  if (parse(dir).root === dir) throw new WorkspaceError(400, 'cannot open the filesystem root', 'filesystem_root');
  const home = await realpath(homedir()).catch(() => homedir());
  if (dir === home) throw new WorkspaceError(400, 'cannot open the home folder itself', 'home_folder');
  return dir;
}

/** The registered folders as stored (`{ path, name }`), deduplicated by the absolute path they name. */
function registered(defaults) {
  const seen = new Set();
  const out = [];
  for (const w of defaults?.values.workspaces ?? []) {
    const abs = absolute(w.path);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ path: w.path, name: w.name, abs });
  }
  return out;
}

const entry = (dir) => ({ path: tildePath(dir), name: basename(dir) });

/**
 * Routes for the folder list and the switch. `app` is { ctx, switchWorkspace(dir) } from createApp.
 * GET answers absolute paths (the client sends them back); drawing.json keeps `~/…` for folders under HOME.
 */
export function workspaceRoutes(app) {
  const { ctx } = app;
  const defaults = () => ctx.modules.userDefaults?.defaults ?? null;

  async function list() {
    const d = defaults();
    if (d) await d.load();
    const current = ctx.workspaceDir;
    const folders = [];
    const seen = new Set();
    for (const w of registered(d)) {
      seen.add(w.abs);
      const ok = await stat(w.abs).then((s) => s.isDirectory(), () => false);
      folders.push({ path: w.abs, name: w.name || basename(w.abs), current: w.abs === current, missing: !ok });
    }
    // The folder this server started with is always listed, even before it is saved in drawing.json.
    if (current && !seen.has(current)) folders.unshift({ path: current, name: basename(current), current: true, missing: false });
    return { current: current ? { path: current, name: basename(current) } : null, folders, switchable: !ctx.projectMode, error: d?.error ? 'defaults_broken' : null };
  }

  /** Saves `workspaces` (adding `dirs` not in it yet, the current folder first) and `lastWorkspace`. */
  async function remember(dirs, last) {
    const d = defaults();
    if (!d) return;
    await d.load();
    const list = registered(d).map(({ path, name }) => ({ path, name }));
    const have = new Set(registered(d).map((w) => w.abs));
    for (const dir of dirs) {
      if (!dir || have.has(dir)) continue;
      have.add(dir);
      list.push(entry(dir));
    }
    await d.update({ workspaces: list, ...(last ? { lastWorkspace: tildePath(last) } : {}) });
  }

  async function open(dir) {
    const from = ctx.workspaceDir;
    await app.switchWorkspace(dir);
    // The switch already happened; a drawing.json that cannot be written only loses "open last".
    await remember([from, dir], dir).catch((err) => console.error('workspaces: could not save drawing.json', err.code ?? err.name));
    return list();
  }

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = async (req) => {
    let s = '';
    for await (const c of req) {
      s += c;
      if (s.length > 16 * 1024) throw new WorkspaceError(413, 'body too large', 'bad_body');
    }
    try {
      return s ? JSON.parse(s) : {};
    } catch {
      throw new WorkspaceError(400, 'invalid JSON', 'bad_body');
    }
  };
  const route = (method, path, fn) => ({
    method,
    path,
    async handler(req, res, _ctx, _m, url) {
      try {
        send(res, 200, await fn(method === 'GET' || method === 'DELETE' ? url : await readBody(req)));
      } catch (err) {
        if (!err?.status) throw err;
        // Messages are English and path-free; the client shows Korean copy by `code`.
        send(res, err.status, { error: err.message, ...(err.code && typeof err.code === 'string' ? { code: err.code } : {}) });
      }
    },
  });

  return [
    route('GET', '/api/workspaces', () => list()),
    // Add a folder (picked in the folder browser) to the list and open it.
    route('POST', '/api/workspaces', async (b) => {
      const dir = await checkFolder(b?.path);
      if (defaults()?.error) throw new WorkspaceError(409, 'drawing.json is broken', 'defaults_broken');
      if (dir === ctx.workspaceDir) {
        await remember([dir], null);
        return list();
      }
      return open(dir);
    }),
    // Switch to a folder already in the list.
    route('POST', '/api/workspaces/open', async (b) => {
      const dir = await checkFolder(b?.path);
      if (dir === ctx.workspaceDir) return list();
      if (!registered(defaults()).some((w) => w.abs === dir)) throw new WorkspaceError(404, 'folder is not in the list', 'not_registered');
      return open(dir);
    }),
    // Take a folder off the list (its files and .drawing/ stay as they are). The open folder cannot be removed.
    route('DELETE', '/api/workspaces', async (url) => {
      const raw = url.searchParams.get('path');
      if (!raw || !isAbsolute(raw)) throw new WorkspaceError(400, 'path must be absolute', 'bad_path');
      const abs = join(raw);
      if (abs === ctx.workspaceDir) throw new WorkspaceError(409, 'the open folder cannot be removed', 'current');
      const d = defaults();
      if (d) {
        await d.load();
        if (d.error) throw new WorkspaceError(409, 'drawing.json is broken', 'defaults_broken');
        const all = registered(d);
        if (all.some((w) => w.abs === abs)) {
          const lastAbs = d.values.lastWorkspace ? absolute(d.values.lastWorkspace) : null;
          await d.update({ workspaces: all.filter((w) => w.abs !== abs).map(({ path, name }) => ({ path, name })), ...(lastAbs === abs ? { lastWorkspace: null } : {}) });
        }
      }
      return list();
    }),
  ];
}
