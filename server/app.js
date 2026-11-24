// HTTP app: API routes from feature modules, SSE hub, static files from public/.
import { createServer } from 'node:http';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHub } from './events.js';
import { serveStatic } from './static.js';
import { modules } from './modules.js';
import { WorkspaceError, workspaceRoutes } from './workspaces.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/**
 * Feature module contract (see server/modules.js):
 *   export async function setup(ctx) -> { routes?: Route[], close?: () => any }
 *   Route = { method: 'GET', path: '/api/x' | RegExp, handler(req, res, ctx, match, url) }
 *   match is the RegExp match (or [pathname] for a string path); url is the parsed URL.
 * Modules are closed in reverse setup order.
 * A module may also return listening(): run once the server listens (ctx.port is known then).
 * ctx = { workspaceDir, projectMode, hub, modules, port } where modules holds each module's
 * setup() result by name, so later modules can use earlier ones; port is the listening port
 * (0 before listen).
 *
 * switchWorkspace(dir) (E554) moves the running server to another workspace folder: every module is closed and
 * set up again for the new folder, so modules never need to handle a changing ctx.workspaceDir themselves.
 */
// Project mode (start.sh <project>, issues #773, #782): the whole app for one git project, its documents in
// <project>/.atelier/. Only the workspace folder list stays closed: the server belongs to that one project.
const PROJECT_MODE_BLOCKED = [
  ['POST', /^\/api\/workspaces(\/open)?$/],
  ['DELETE', /^\/api\/workspaces$/],
];

/**
 * The git project's folder name for /api/info: the Dispatch module's project root when it runs, else in project
 * mode the folder that holds the workspace (<project>/.atelier). Folder name only, never the full path.
 */
export function projectName(ctx) {
  const root = ctx.modules?.dispatch?.projectRoot;
  if (root) return basename(root);
  return ctx.projectMode && ctx.workspaceDir ? basename(dirname(ctx.workspaceDir)) : null;
}

// Session states that a switch would cut off: the switch is refused while any session is in one.
const BUSY = new Set(['running', 'starting', 'waiting']);

/**
 * opts.lock: the workspace lock index.js took (released on a switch); deps.claimWorkspace(dir) -> { ok, lock }
 * claims the next folder's lock on a switch (lock.js claimWorkspace; tests leave it out).
 */
export async function createApp(opts = {}, { publicDir = PUBLIC_DIR, moduleList = modules, claimWorkspace = null } = {}) {
  const hub = createHub();
  let server = null;
  const ctx = {
    workspaceDir: opts.workspaceDir,
    projectMode: !!opts.projectMode,
    hub,
    modules: {},
    lock: opts.lock ?? null,
    get port() {
      return server?.address()?.port ?? 0;
    },
  };
  const base = [
    { method: 'GET', path: '/api/events', handler: (req, res) => hub.attach(req, res) },
    // Folder name only, never the full path.
    {
      method: 'GET',
      path: '/api/info',
      handler: (req, res) => sendJson(res, 200, { workspace: basename(ctx.workspaceDir ?? ''), mode: ctx.projectMode ? 'project' : 'drawing', project: projectName(ctx) }),
    },
  ];
  // What the modules set up for the open workspace; replaced as a whole on a switch.
  let active = { routes: [], closers: [], listeners: [] };
  // Set while a switch runs: requests wait for it, so none reaches a module that is being closed.
  let switching = null;

  async function startModules() {
    const next = { routes: [], closers: [], listeners: [] };
    ctx.modules = {};
    try {
      for (const { name, setup } of moduleList) {
        const m = (await setup(ctx)) ?? {};
        ctx.modules[name] = m;
        if (m.routes) next.routes.push(...m.routes);
        if (m.close) next.closers.push(m.close);
        if (m.listening) next.listeners.push([name, m.listening]);
      }
    } catch (err) {
      await stopModules(next);
      ctx.modules = {}; // none of them is usable once closed
      throw err;
    }
    active = next;
  }
  async function stopModules(set = active) {
    for (const c of [...set.closers].reverse()) {
      try {
        await c();
      } catch (err) {
        console.error('module close failed:', err?.code ?? err?.name);
      }
    }
  }
  async function runListeners() {
    for (const [name, fn] of active.listeners) {
      try {
        await fn();
      } catch (err) {
        console.error(`${name} start failed:`, err?.code ?? err?.name);
      }
    }
  }

  async function doSwitch(dir) {
    const sessions = ctx.modules.dispatch?.hub?.sessions ?? [];
    if (sessions.some((s) => BUSY.has(s.status))) throw new WorkspaceError(409, 'agent sessions are running', 'sessions_running');
    let lock = null;
    if (claimWorkspace) {
      try {
        const claim = await claimWorkspace(dir);
        if (!claim.ok) throw new WorkspaceError(409, 'another Atelier server has this folder open', 'in_use');
        lock = claim.lock;
      } catch (err) {
        if (err instanceof WorkspaceError) throw err;
        // Same as at start: a read-only folder can still be viewed without the lock.
        console.error(`Could not lock the workspace (${err.code ?? err.name}); not guarding against a second server.`);
      }
    }
    const from = { dir: ctx.workspaceDir, lock: ctx.lock };
    // Open pages reload on this event; their streams are then closed so module snapshots start fresh.
    hub.broadcast('workspace-switch', { workspace: basename(dir) });
    hub.closeAll();
    hub.clearAttachers();
    await stopModules();
    active = { routes: [], closers: [], listeners: [] };
    ctx.workspaceDir = dir;
    ctx.lock = lock;
    try {
      await startModules();
    } catch (err) {
      console.error('workspace switch failed:', err?.code ?? err?.name);
      await lock?.release().catch(() => {});
      hub.clearAttachers();
      ctx.workspaceDir = from.dir;
      ctx.lock = from.lock;
      try {
        await startModules();
        await runListeners();
      } catch (again) {
        // The old folder could not be set up again either: no modules are active, but the answer stays open_failed.
        console.error('workspace restore failed:', again?.code ?? again?.name);
      }
      throw new WorkspaceError(500, 'could not open the folder', 'open_failed');
    }
    await from.lock?.release().catch(() => {});
    await runListeners();
    await lock?.setPort(ctx.port).catch((err) => console.error(`Could not update the workspace lock (${err.code ?? err.name})`));
    // Folder name only: the full path can hold the user name.
    console.log(`Atelier: switched to workspace ${basename(dir)}`);
  }

  /** Moves the server to the workspace folder `dir` (an absolute real path). One switch at a time. */
  async function switchWorkspace(dir) {
    if (ctx.projectMode) throw new WorkspaceError(403, 'project mode cannot switch folders', 'project_mode');
    if (switching) throw new WorkspaceError(409, 'a switch is already running', 'switching');
    if (dir === ctx.workspaceDir) return;
    switching = doSwitch(dir);
    try {
      await switching;
    } finally {
      switching = null;
    }
  }

  const app = { ctx, switchWorkspace };
  base.push(...workspaceRoutes(app));
  await startModules();

  server = createServer(async (req, res) => {
    // DNS rebinding guard: only answer requests addressed to this loopback port.
    if (!isAllowedHost(req.headers.host, server.address()?.port)) {
      return sendJson(res, 403, { error: 'forbidden host' });
    }
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD' && !writeAllowed(req.headers)) {
          return sendJson(res, 403, { error: 'forbidden' });
        }
        if (ctx.projectMode && PROJECT_MODE_BLOCKED.some(([m, re]) => m === req.method && re.test(url.pathname))) {
          return sendJson(res, 403, { error: 'project mode: the workspace folder cannot change' });
        }
        if (switching && !url.pathname.startsWith('/api/workspaces')) await switching.catch(() => {});
        for (const r of [...base, ...active.routes]) {
          if (r.method !== req.method) continue;
          const match = r.path instanceof RegExp ? url.pathname.match(r.path) : r.path === url.pathname ? [url.pathname] : null;
          if (match) return await r.handler(req, res, ctx, match, url);
        }
        return sendJson(res, 404, { error: 'not found' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
      return await serveStatic(req, res, url.pathname, publicDir);
    } catch (err) {
      // err.message can hold absolute paths; log only the error kind.
      console.error('request failed:', err.code ?? err.name);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    }
  });

  server.on('listening', () => runListeners());

  async function close() {
    await switching?.catch(() => {});
    hub.closeAll();
    await stopModules();
    const closed = new Promise((r) => server.close(r));
    server.closeAllConnections(); // don't wait for idle keep-alive sockets
    await closed;
  }

  app.server = server;
  app.close = close;
  return app;
}

/**
 * Every non-GET /api request needs a custom header: a browser can't send it cross-origin without a
 * preflight this server never approves, so another site can't write here. x-drawing: 1 is
 * Atelier's own; x-dispatch: 1 is accepted for the Dispatch plugin.
 */
export function writeAllowed(headers) {
  return headers['x-drawing'] === '1' || headers['x-dispatch'] === '1';
}

export function isAllowedHost(host, port) {
  if (!host || !port) return false;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}
