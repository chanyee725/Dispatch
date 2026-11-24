import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readdir, readFile, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createApp } from '../server/app.js';
import { modules } from '../server/modules.js';
import { claimWorkspace } from '../server/lock.js';
import { execFileSync } from 'node:child_process';

// Scratch folders only (never a real project): a workspace and a fake "home" with folders to browse.
// `defaults: true` turns ~/.atelier/drawing.json on for the test; HOME is the scratch home, never the real one.
async function withApp(fn, { defaults = false, moduleList = modules, deps = {}, ...opts } = {}) {
  const ws = await realpath(await mkdtemp(join(tmpdir(), 'draw-lf-ws-')));
  const home = await realpath(await mkdtemp(join(tmpdir(), 'draw-lf-home-')));
  const oldHome = process.env.HOME;
  const oldDefaults = process.env.DRAWING_USER_DEFAULTS;
  process.env.HOME = home;
  if (defaults) delete process.env.DRAWING_USER_DEFAULTS;
  const app = await createApp({ workspaceDir: ws, ...opts }, { publicDir: ws, moduleList, ...deps });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body, headers = { 'x-drawing': '1' }) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn({ ws, home, call, app });
  } finally {
    process.env.HOME = oldHome;
    if (oldDefaults === undefined) delete process.env.DRAWING_USER_DEFAULTS;
    else process.env.DRAWING_USER_DEFAULTS = oldDefaults;
    await app.close();
    await rm(ws, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
}

const q = (p) => `/api/local-folders?path=${encodeURIComponent(p)}`;

test('local folders: lists sub-folder names only, starts at home, skips hidden, files and symlinks', async () => {
  await withApp(async ({ home, call }) => {
    await mkdir(join(home, 'code', 'app'), { recursive: true });
    await mkdir(join(home, 'Docs'));
    await mkdir(join(home, '.secret'));
    await writeFile(join(home, '.env'), 'X=1');
    await writeFile(join(home, 'notes.txt'), 'hi');
    await symlink(join(home, 'code'), join(home, 'link-to-code'));

    const r = await call('GET', '/api/local-folders');
    assert.equal(r.status, 200);
    assert.equal(r.body.path, home);
    assert.equal(r.body.home, home);
    assert.deepEqual(r.body.folders, ['code', 'Docs']);
    assert.equal(r.body.truncated, false);
    assert.equal(typeof r.body.parent, 'string');

    const sub = await call('GET', q(join(home, 'code')));
    assert.deepEqual([sub.body.path, sub.body.parent, sub.body.folders], [join(home, 'code'), home, ['app']]);
    // A symlink in the request is resolved to its real folder.
    assert.equal((await call('GET', q(join(home, 'link-to-code')))).body.path, join(home, 'code'));
    assert.equal((await call('GET', q('/'))).body.parent, null);
  });
});

test('local folders: bad paths are client errors without absolute paths in the message', async () => {
  await withApp(async ({ home, call }) => {
    await writeFile(join(home, 'file.txt'), 'x');
    const cases = [
      [q('relative/path'), 400],
      [q(join(home, 'missing')), 404],
      [q(join(home, 'file.txt')), 400],
      [q(`${home}/\0x`), 400],
    ];
    for (const [url, status] of cases) {
      const r = await call('GET', url);
      assert.equal(r.status, status, url);
      assert.equal(r.body.error.includes(home), false);
    }
    if (process.getuid?.() !== 0) {
      const locked = join(home, 'locked');
      await mkdir(locked);
      await chmod(locked, 0o000);
      try {
        assert.equal((await call('GET', q(locked))).status, 403);
      } finally {
        await chmod(locked, 0o755);
      }
    }
  });
});

test('workspaces: picking a folder adds it to drawing.json and switches the server to it', async () => {
  await withApp(
    async ({ ws, home, call }) => {
      const other = join(home, 'code', 'app');
      await mkdir(other, { recursive: true });
      await mkdir(join(ws, 'a'));

      const before = await call('GET', '/api/workspaces');
      assert.deepEqual(before.body.folders.map((f) => [f.path, f.current]), [[ws, true]]);

      const r = await call('POST', '/api/workspaces', { path: other });
      assert.equal(r.status, 200);
      assert.equal(r.body.current.path, other);
      assert.equal((await call('GET', '/api/info')).body.workspace, 'app');
      // The new folder has its own project folders.
      assert.deepEqual((await call('GET', '/api/workspace/projects')).body.projects, []);

      // Metadata only: `~/…` path and folder name; both folders listed, the last one opened remembered.
      const saved = JSON.parse(await readFile(join(home, '.atelier', 'drawing.json'), 'utf8'));
      assert.deepEqual(saved.workspaces, [{ path: ws, name: basename(ws) }, { path: '~/code/app', name: 'app' }]);
      assert.equal(saved.lastWorkspace, '~/code/app');

      // Back to the first folder: its documents are still there, the other folder's are not.
      const back = await call('POST', '/api/workspaces/open', { path: ws });
      assert.equal(back.status, 200);
      const names = (await call('GET', '/api/workspace/projects')).body.projects.map((n) => n.name);
      assert.deepEqual(names, ['a']);
      assert.equal(JSON.parse(await readFile(join(home, '.atelier', 'drawing.json'), 'utf8')).lastWorkspace, ws);

      // Removing takes it off the list only; the open folder cannot be removed.
      assert.equal((await call('DELETE', `/api/workspaces?path=${encodeURIComponent(ws)}`)).body.code, 'current');
      const del = await call('DELETE', `/api/workspaces?path=${encodeURIComponent(other)}`);
      assert.equal(del.status, 200);
      assert.deepEqual(del.body.folders.map((f) => f.path), [ws]);
      assert.ok((await readdir(other).catch(() => null)) !== null, 'the folder itself stays');
    },
    { defaults: true },
  );
});

test('workspaces: refuses home, root, files, unknown folders and writes without the header', async () => {
  await withApp(async ({ home, call }) => {
    await writeFile(join(home, 'f.txt'), 'x');
    await mkdir(join(home, 'p'));
    const cases = [
      ['POST', '/api/workspaces', { path: home }, 400, 'home_folder'],
      ['POST', '/api/workspaces', { path: '/' }, 400, 'filesystem_root'],
      ['POST', '/api/workspaces', { path: join(home, 'f.txt') }, 400, 'bad_path'],
      ['POST', '/api/workspaces', { path: join(home, 'missing') }, 404, 'not_found'],
      ['POST', '/api/workspaces', { path: 'rel/p' }, 400, 'bad_path'],
      ['POST', '/api/workspaces/open', { path: join(home, 'p') }, 404, 'not_registered'],
    ];
    for (const [m, path, body, status, code] of cases) {
      const r = await call(m, path, body);
      assert.deepEqual([r.status, r.body.code], [status, code], `${m} ${JSON.stringify(body)}`);
      assert.ok(!r.body.error.includes(home), 'no paths in error messages');
    }
    assert.equal((await call('POST', '/api/workspaces', { path: join(home, 'p') }, {})).status, 403);
  });
});

test('workspaces: no switch while an agent session is running, none in project mode', async () => {
  const busy = { name: 'dispatch', setup: () => ({ hub: { sessions: [{ status: 'running' }] } }) };
  await withApp(
    async ({ ws, home, call }) => {
      await mkdir(join(home, 'p'));
      const r = await call('POST', '/api/workspaces', { path: join(home, 'p') });
      assert.deepEqual([r.status, r.body.code], [409, 'sessions_running']);
      assert.equal((await call('GET', '/api/workspaces')).body.current.path, ws);
    },
    { moduleList: [...modules.filter((m) => m.name !== 'dispatch'), busy] },
  );
  await withApp(
    async ({ home, call }) => {
      await mkdir(join(home, 'p'));
      assert.equal((await call('POST', '/api/workspaces', { path: join(home, 'p') })).status, 403);
      assert.equal((await call('GET', '/api/workspaces')).body.switchable, false);
    },
    { projectMode: true },
  );
});

test('workspaces: a failed switch whose rollback also fails answers open_failed', async () => {
  let calls = 0;
  const flaky = {
    name: 'flaky',
    setup: () => {
      if (calls++ > 0) throw Object.assign(new Error('boom'), { code: 'EFAKE' });
      return {};
    },
  };
  await withApp(
    async ({ home, call, app }) => {
      await mkdir(join(home, 'p'));
      const r = await call('POST', '/api/workspaces', { path: join(home, 'p') });
      assert.deepEqual([r.status, r.body.code], [500, 'open_failed']);
      assert.equal(calls, 3, 'tried the new folder, then the old one again');
      assert.deepEqual(app.ctx.modules, {});
    },
    { moduleList: [...modules, flaky] },
  );
});

test('workspaces: the switch moves the workspace lock to the new folder', async () => {
  await withApp(
    async ({ ws, home, call, app }) => {
      const other = join(home, 'p');
      await mkdir(other);
      assert.equal((await call('POST', '/api/workspaces', { path: other })).status, 200);
      assert.ok((await readdir(join(other, '.drawing'))).includes('server.lock'));
      assert.ok(!(await readdir(join(ws, '.drawing')).catch(() => [])).includes('server.lock'));
      assert.equal(app.ctx.lock !== null, true);
    },
    { deps: { claimWorkspace } },
  );
});

test('workspaces: agent sessions follow the open folder: on in a git project, off outside one', async () => {
  await withApp(async ({ home, call }) => {
    const repo = join(home, 'repo');
    await mkdir(join(repo, 'docs'), { recursive: true });
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    assert.equal((await call('GET', '/api/dispatch')).body.enabled, false);
    assert.equal((await call('POST', '/api/workspaces', { path: join(repo, 'docs') })).status, 200);
    assert.equal((await call('GET', '/api/dispatch')).body.enabled, true);
  });
});
