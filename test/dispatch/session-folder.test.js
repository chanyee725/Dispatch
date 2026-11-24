// E505c: every session has a `folder` (top folder path or null). Runs against a scratch git repo in a
// temp dir with the fake CLIs only; no real claude is started.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.js';
import * as workspace from '../../server/workspace/index.js';
import * as dispatch from '../../server/dispatch/index.js';
import { Hub } from '../../server/dispatch/hub.js';
import { deriveFolder, topFolder } from '../../server/dispatch/session-folder.js';
import { fakeCliBin, fakeSpawner, until } from '../fixtures/fake-cli/index.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function start() {
  const root = mkdtempSync(join(tmpdir(), 'drawing-e505c-'));
  dirs.push(root);
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(root, 'ws');
  mkdirSync(join(ws, 'alpha'), { recursive: true });
  mkdirSync(join(ws, 'beta'));
  const bin = fakeCliBin();
  dirs.push(bin.dir);
  const p = { installed: true, connected: true, busy: false, url: null, error: null };
  const deps = {
    limitsFile: join(root, 'limits.json'),
    providerStatus: async () => ({ claude: { ...p }, openai: { ...p, connected: false }, gemini: { ...p, connected: false } }),
    codexModels: async () => [], login: () => {}, logout: async () => {}, cancelLogin: () => {},
    spawnCli: fakeSpawner(bin),
  };
  const moduleList = [
    { name: 'workspace', setup: workspace.setup },
    { name: 'dispatch', setup: (ctx) => dispatch.setup(ctx, deps) },
  ];
  const pub = mkdtempSync(join(tmpdir(), 'drawing-e505c-pub-'));
  dirs.push(pub);
  writeFileSync(join(pub, 'index.html'), '<!doctype html>');
  const app = await createApp({ workspaceDir: ws }, { publicDir: pub, moduleList });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const W = { 'content-type': 'application/json', 'x-drawing': '1' };
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: method === 'GET' ? {} : W, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await call('POST', '/api/providers/claude/login')).body.connected, true);
  return { app, call, d: app.ctx.modules.dispatch, ws, stop: () => app.close() };
}

const mk = (call, body) => call('POST', '/api/sessions', { worktree: false, ...body });
const settled = (d, id) => until(() => ['idle', 'done'].includes(d.hub.get(id).status), 10_000);

test('POST /api/sessions: folder must be an existing top folder; it shows in the snapshot and /api/state', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d } = t;
    const ok = await mk(call, { items: [{ role: 'lead', task: 'x' }], folder: 'alpha' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.sessions[0].folder, 'alpha');
    // 미분류: no project at all, or a file at the root, is null.
    assert.equal((await mk(call, { items: [{ role: 'lead', task: 'x' }] })).body.sessions[0].folder, null);
    for (const bad of ['nope', '../x', 'alpha/sub', '.drawing', 7]) {
      const r = await mk(call, { items: [{ role: 'lead', task: 'x' }], folder: bad });
      assert.equal(r.status, 400, String(bad));
      assert.match(r.body.error, /프로젝트 폴더/);
    }
    const state = (await call('GET', '/api/state')).body;
    assert.equal(state.sessions.find((s) => s.id === ok.body.sessions[0].id).folder, 'alpha');
    // Stored in state.json (metadata only, no transcript text).
    await d.store.flush();
    const disk = JSON.parse(readFileSync(join(d.root, '.atelier', 'state.json'), 'utf8'));
    assert.equal(disk.sessions[ok.body.sessions[0].id].folder, 'alpha');
  } finally { await t.stop(); }
});

test('a session made by another session inherits its folder unless it names one', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d } = t;
    const lead = (await mk(t.call, { items: [{ role: 'lead', task: 'x' }], folder: 'alpha' })).body.sessions[0];
    await settled(d, lead.id);
    const kid = await mk(call, { items: [{ role: 'impl', task: 'y' }], parent: lead.id });
    assert.equal(kid.body.sessions[0].folder, 'alpha');
    const other = await mk(call, { items: [{ role: 'impl', task: 'y' }], parent: lead.id, folder: 'beta' });
    assert.equal(other.body.sessions[0].folder, 'beta');
    // The MCP tool passes `folder` through.
    assert.match(readFileSync(new URL('../../server/dispatch/mcp.js', import.meta.url), 'utf8'), /folder: \{ type: "string"/);
  } finally { await t.stop(); }
});

test('old sessions without folder: derived from a plan link only, else null', () => {
  const plans = { 'alpha/a.dpx.json': { lead: 'L1', links: { S1: 'api' } }, 'root.dpx.json': { lead: 'L2', links: { S2: 'x' } } };
  assert.equal(deriveFolder({ id: 'S1' }, plans), 'alpha');
  assert.equal(deriveFolder({ id: 'L1' }, plans), null); // not linked
  assert.equal(deriveFolder({ id: 'S2' }, plans), null); // plan at the root
  assert.equal(deriveFolder({ id: 'S3' }, undefined), null);
  assert.equal(topFolder('a.dpx.json'), null);
  assert.equal(topFolder('x/y/a.dpx.json'), 'x');
});

test('the Hub backfills folder on old sessions at start and keeps explicit values', () => {
  const store = {
    data: {
      seq: 0, settings: {}, daily: {},
      pipelines: { 'alpha/a.dpx.json': { lead: 'L', links: { S: 'api' } } },
      sessions: {
        L: { id: 'L', status: 'idle', color: 'x' }, S: { id: 'S', parent: 'L', status: 'idle', color: 'x' },
        N: { id: 'N', status: 'idle', color: 'x', folder: null },
      },
    },
    save() {},
  };
  const hub = new Hub({ root: '/nonexistent', store, models: [], roles: [], port: 1, limits: new EventEmitter() });
  assert.equal(hub.get('S').folder, 'alpha');
  assert.equal(hub.get('L').folder, null); // not linked: 미분류
  assert.equal(hub.get('N').folder, null);
  assert.equal(hub.publicSession(hub.get('S')).folder, 'alpha');
});

test('GET /api/usage?folder: cost and tokens of that project only', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d } = t;
    const a = (await mk(call, { items: [{ role: 'impl', task: 'x' }], folder: 'alpha' })).body.sessions[0];
    const b = (await mk(call, { items: [{ role: 'impl', task: 'x' }], folder: 'beta' })).body.sessions[0];
    await settled(d, a.id); await settled(d, b.id);
    d.hub.get(a.id).cost = 1.5; d.hub.get(a.id).usage = { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 };
    d.hub.get(b.id).cost = 4; d.hub.get(b.id).usage = { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 };
    const u = await call('GET', '/api/usage?folder=alpha');
    assert.deepEqual(u.body, { folder: 'alpha', sessions: 1, cost: 1.5, tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 } });
    assert.equal((await call('GET', '/api/usage?folder=beta')).body.cost, 4);
    assert.equal((await call('GET', '/api/usage?folder=..%2Fx')).status, 400);
    assert.ok(Array.isArray((await call('GET', '/api/usage')).body.days)); // global shape unchanged
  } finally { await t.stop(); }
});
