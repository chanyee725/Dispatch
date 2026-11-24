// Workspace module: the workspace's project folders (names only), the local folder picker and the per-workspace
// PR/CI tracking switch. Documents, plans and runs are gone; agent sessions live in server/dispatch/.
import { StoreError } from './errors.js';
import { listProjects, topFolderNames } from './projects.js';
import { listLocalFolders } from './local-folders.js';
// The PR/CI switch lives with the Dispatch PR tracker (it reads the same settings.json), so the route reuses it.
import { readPrTracking, setPrTracking } from '../dispatch/pr-status.js';

export { StoreError };

const SETTINGS_BROKEN = '설정 파일을 읽을 수 없어요. 파일을 확인해 주세요.';
const MAX_BODY = 64 * 1024;
/** Top-level workspace names project mode keeps for itself (#782): agent git worktrees, never project folders. */
export const RESERVED_PROJECT_NAMES = Object.freeze(['worktrees']);

async function readJson(req) {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) throw new StoreError(415, 'content-type must be application/json');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new StoreError(413, 'body too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new StoreError(400, 'invalid JSON');
  }
}

export async function setup(ctx) {
  if (!ctx.workspaceDir) return {};
  const root = ctx.workspaceDir;
  const reserved = ctx.projectMode ? RESERVED_PROJECT_NAMES : [];

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const route = (method, path, fn) => ({
    method,
    path,
    async handler(req, res, _ctx, _m, url) {
      try {
        const body = method === 'GET' || method === 'DELETE' ? null : await readJson(req);
        send(res, 200, await fn(url.searchParams.get('path'), body));
      } catch (err) {
        if (!(err instanceof StoreError)) throw err;
        send(res, err.status, { error: err.message });
      }
    },
  });

  return {
    /** Names of the workspace's top-level project folders (no files, hidden entries or symlinks). */
    topFolders: () => topFolderNames(root, reserved),
    routes: [
      // Projects view (top-level folders). Not /api/projects: Dispatch owns that path.
      route('GET', '/api/workspace/projects', () => listProjects(root, reserved)),
      // Folder picker for 폴더 열기 (E554): sub-folder names of a folder on the server machine, read-only.
      route('GET', '/api/local-folders', (p) => listLocalFolders(p)),
      // Per-workspace PR/CI tracking switch (E57 settings dialog); stored in <workspace>/.drawing/settings.json.
      route('GET', '/api/workspace/pr-tracking', async () => {
        try {
          const ud = ctx.modules.userDefaults?.defaults;
          return { on: await readPrTracking(ctx.workspaceDir, (ud ? (await ud.current()).prStatus : undefined) ?? true) };
        } catch (e) {
          if (e?.code === 'ESETTINGS') throw new StoreError(409, SETTINGS_BROKEN);
          throw e;
        }
      }),
      route('POST', '/api/workspace/pr-tracking', async (_p, b) => {
        if (typeof b?.on !== 'boolean') throw new StoreError(400, 'on must be true or false');
        try {
          await setPrTracking(ctx.workspaceDir, b.on);
        } catch (e) {
          if (e?.code === 'ESETTINGS') throw new StoreError(409, SETTINGS_BROKEN);
          throw e;
        }
        return { on: b.on };
      }),
    ],
  };
}
