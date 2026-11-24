// E555 (#724): the user's defaults in ~/.atelier/drawing.json. Every test uses a temp HOME; the real
// ~/.dispatch is never read or written. No agent CLI is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import * as workspace from '../server/workspace/index.js';
import * as dispatch from '../server/dispatch/index.js';
import * as userDefaults from '../server/user-defaults.js';
import { createPrStatus } from '../server/dispatch/pr-status.js';
import { defaultsFile, KEY_ORDER, readDefaultsSync, serialize, startDefaults, UserDefaults } from '../server/user-defaults.js';

const W = { 'content-type': 'application/json', 'x-drawing': '1' };

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'drawing-e555-home-'));
  const file = join(home, '.atelier', 'drawing.json');
  const put = (text) => {
    mkdirSync(join(home, '.atelier'), { recursive: true });
    writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text));
  };
  return { home, file, put, read: () => readFileSync(file, 'utf8'), done: () => rmSync(home, { recursive: true, force: true }) };
}

test('defaultsFile: ~/.atelier/drawing.json under HOME; DRAWING_USER_DEFAULTS=off turns the file off', () => {
  assert.equal(defaultsFile({ HOME: '/h' }), '/h/.atelier/drawing.json');
  assert.equal(defaultsFile({ HOME: '/h', DRAWING_USER_DEFAULTS: 'off' }), null);
});

test('serialize: known keys in a fixed order, unknown keys after them, 2-space indent', () => {
  const text = serialize({ zeta: 1, workspaces: [], theme: 'dark', version: 1, alpha: { b: 2 }, port: 4400 });
  assert.deepEqual(Object.keys(JSON.parse(text)), ['version', 'theme', 'port', 'workspaces', 'zeta', 'alpha']);
  assert.ok(text.startsWith('{\n  "version": 1,\n'));
  assert.ok(text.endsWith('}\n'));
  assert.deepEqual(KEY_ORDER.slice(-2), ['workspaces', 'lastWorkspace']);
});

test('update: creates the file with a version, keeps unknown keys and hand edits, removes a key on null', async () => {
  const h = tempHome();
  try {
    const d = new UserDefaults(h.file);
    await d.load();
    assert.equal(d.error, null);
    assert.deepEqual(d.values, {});
    await d.update({ theme: 'dark' });
    assert.deepEqual(JSON.parse(h.read()), { version: 1, theme: 'dark' });

    // A hand edit made while the server runs (an unknown key, a new port) survives the next write.
    h.put({ myNote: 'keep me', version: 1, theme: 'dark', port: 4500 });
    await d.update({ prStatus: false });
    const after = JSON.parse(h.read());
    assert.deepEqual(after, { version: 1, theme: 'dark', port: 4500, prStatus: false, myNote: 'keep me' });
    assert.deepEqual(Object.keys(after), ['version', 'theme', 'port', 'prStatus', 'myNote']);

    await d.update({ port: null });
    assert.equal('port' in JSON.parse(h.read()), false);
  } finally {
    h.done();
  }
});

test('a broken file: values fall back to empty, the status names it, writes refuse and leave it as it was', async () => {
  const h = tempHome();
  try {
    h.put('{ "theme": "dark", ');
    const d = new UserDefaults(h.file);
    await d.load();
    assert.equal(d.error, 'not valid JSON');
    assert.deepEqual(d.values, {});
    assert.match(d.status().error, /drawing\.json/);
    await assert.rejects(d.update({ theme: 'light' }), (e) => e.code === 'EDEFAULTS' && e.status === 409);
    assert.equal(h.read(), '{ "theme": "dark", ');

    h.put('[1, 2]');
    await d.load();
    assert.equal(d.error, 'not a JSON object');
    assert.equal(readDefaultsSync({ HOME: h.home }).error, 'not a JSON object');
  } finally {
    h.done();
  }
});

test('a value with the wrong type is ignored and named; the rest still apply', async () => {
  const h = tempHome();
  try {
    h.put({ theme: 'purple', port: 'x', team: { rotateLead: 3, maxChildren: 'many', roleModels: { lead: 'm1', bad: 5 } }, guard: { five: 0.8, seven: 7 }, workspaces: [{ path: '/a/b' }, 'nope'], lastWorkspace: '/a/b' });
    const d = new UserDefaults(h.file);
    await d.load();
    assert.equal(d.error, null);
    assert.deepEqual(d.problems.sort(), ['port', 'theme']);
    assert.deepEqual(d.values.team, { rotateLead: 3, roleModels: { lead: 'm1' } });
    assert.deepEqual(d.values.guard, { five: 0.8 });
    assert.deepEqual(d.values.workspaces, [{ path: '/a/b', name: 'b' }]);
    assert.equal(d.values.lastWorkspace, '/a/b');
  } finally {
    h.done();
  }
});

test('startDefaults: workspace, then lastWorkspace; DRAW_PORT, then the file, then the built-in port', () => {
  assert.deepEqual(startDefaults({}, {}, 4330), { workspaceDir: null, port: 4330 });
  assert.deepEqual(startDefaults({ workspace: '~/w', port: 4400 }, { HOME: '/h' }, 4330), { workspaceDir: '/h/w', port: 4400 });
  assert.deepEqual(startDefaults({ lastWorkspace: '/l', port: 4400 }, { DRAW_PORT: '4999' }, 4330), { workspaceDir: '/l', port: 4999 });
});

function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'drawing-e555-'));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(root, 'ws');
  mkdirSync(ws);
  return { root, ws };
}

const fakeDeps = (dir) => ({
  limitsFile: join(dir, 'limits.json'),
  providerStatus: async () => ({}),
  codexModels: async () => [],
  login: () => {},
  logout: async () => {},
  cancelLogin: () => {},
});

async function start(ws, file, deps) {
  const moduleList = [
    { name: 'userDefaults', setup: (ctx) => userDefaults.setup(ctx, { file }) },
    { name: 'workspace', setup: workspace.setup },
    { name: 'dispatch', setup: (ctx) => dispatch.setup(ctx, deps) },
  ];
  const pub = mkdtempSync(join(tmpdir(), 'drawing-e555-pub-'));
  writeFileSync(join(pub, 'index.html'), '<!doctype html>');
  const app = await createApp({ workspaceDir: ws }, { publicDir: pub, moduleList });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { base, stop: async () => { await app.close(); rmSync(pub, { recursive: true, force: true }); } };
}

test('server: drawing.json wins over state.json; 설정 changes are written back to it', async () => {
  const h = tempHome();
  const { root, ws } = scratchRepo();
  // The old places: team settings in the project's state.json, a PR switch nowhere.
  mkdirSync(join(root, '.atelier'), { recursive: true });
  writeFileSync(join(root, '.atelier', 'state.json'), JSON.stringify({ settings: { team: { rotateLead: 7, maxChildren: 3 } } }));
  h.put({ version: 1, theme: 'dark', prStatus: false, team: { rotateLead: 2 }, guard: { five: 0.5 }, extra: { kept: true } });
  const s = await start(ws, h.file, fakeDeps(root));
  try {
    const snap = await (await fetch(`${s.base}/api/user-defaults`)).json();
    assert.equal(snap.file, '~/.atelier/drawing.json');
    assert.equal(snap.error, null);
    assert.equal(snap.values.theme, 'dark');
    // PR tracking: no workspace value, so the user's default (off) applies.
    assert.equal((await (await fetch(`${s.base}/api/workspace/pr-tracking`)).json()).on, false);

    const r = await fetch(`${s.base}/api/settings`, { method: 'POST', headers: W, body: JSON.stringify({ team: { maxChildren: 5 }, guard: { seven: 0.7 } }) });
    assert.equal(r.status, 200);
    const settings = await r.json();
    // drawing.json's rotateLead (2) beat state.json's 7; state.json's maxChildren was the fallback before the change.
    assert.equal(settings.team.rotateLead, 2);
    assert.equal(settings.team.maxChildren, 5);
    assert.equal(settings.guard.five, 0.5);
    const saved = JSON.parse(h.read());
    assert.equal(saved.team.maxChildren, 5);
    assert.equal(saved.team.rotateLead, 2);
    assert.equal(saved.guard.seven, 0.7);
    assert.equal('enabled' in saved.guard, false);
    assert.deepEqual(saved.extra, { kept: true });

    const p = await fetch(`${s.base}/api/user-defaults`, { method: 'POST', headers: W, body: JSON.stringify({ theme: 'light', port: 4444, workspace: '~/drawings', secret: 'x' }) });
    assert.equal(p.status, 200);
    const now = JSON.parse(h.read());
    assert.equal(now.theme, 'light');
    assert.equal(now.port, 4444);
    assert.equal(now.workspace, '~/drawings');
    assert.equal('secret' in now, false);
    assert.equal((await fetch(`${s.base}/api/user-defaults`, { method: 'POST', headers: W, body: JSON.stringify({ port: 80 }) })).status, 400);
    assert.equal((await fetch(`${s.base}/api/user-defaults`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
  } finally {
    await s.stop();
    rmSync(root, { recursive: true, force: true });
    h.done();
  }
});

test('server: a hand edit to drawing.json is seen at once, without GET /api/user-defaults', async () => {
  const h = tempHome();
  const { root, ws } = scratchRepo();
  h.put({ prStatus: false });
  const s = await start(ws, h.file, fakeDeps(root));
  const pr = async () => (await (await fetch(`${s.base}/api/workspace/pr-tracking`)).json()).on;
  try {
    assert.equal(await pr(), false);
    // The user edits the file by hand while the server runs; no route calls GET /api/user-defaults.
    h.put({ prStatus: true });
    assert.equal(await pr(), true);
    h.put({ prStatus: false });
    assert.equal(await pr(), false);
    // Deleting the file brings back the built-in defaults.
    rmSync(h.file);
    assert.equal(await pr(), true);
  } finally {
    await s.stop();
    rmSync(root, { recursive: true, force: true });
    h.done();
  }
});

test('createPrStatus follows a hand edit to drawing.json through current()', async () => {
  const h = tempHome();
  const ws = mkdtempSync(join(tmpdir(), 'drawing-e555-ws-'));
  try {
    h.put({ prStatus: false });
    const d = await new UserDefaults(h.file).load();
    let calls = 0;
    const prStatus = createPrStatus({ workspaceDir: ws, cwd: ws, prDefault: async () => (await d.current()).prStatus ?? true, run: async () => { calls++; return { code: 1, stdout: '', stderr: '' }; }, minGapMs: 0 });
    assert.deepEqual(await prStatus('feat/x'), { ok: false, reason: 'disabled' });
    h.put({ prStatus: true });
    assert.notEqual((await prStatus('feat/x')).reason, 'disabled');
  } finally {
    rmSync(ws, { recursive: true, force: true });
    h.done();
  }
});

test('server: a broken drawing.json does not stop the server; it reports the error and refuses settings writes', async () => {
  const h = tempHome();
  const { root, ws } = scratchRepo();
  h.put('not json');
  const s = await start(ws, h.file, fakeDeps(root));
  try {
    const snap = await (await fetch(`${s.base}/api/user-defaults`)).json();
    assert.match(snap.error, /drawing\.json/);
    const r = await fetch(`${s.base}/api/settings`, { method: 'POST', headers: W, body: JSON.stringify({ team: { maxChildren: 5 } }) });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /drawing\.json/);
    // The user's file is left exactly as it was.
    assert.equal(h.read(), 'not json');
    assert.equal((await fetch(`${s.base}/api/user-defaults`, { method: 'POST', headers: W, body: JSON.stringify({ theme: 'dark' }) })).status, 409);
  } finally {
    await s.stop();
    rmSync(root, { recursive: true, force: true });
    h.done();
  }
});

const freePort = () =>
  new Promise((ok, fail) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
    srv.on('error', fail);
  });

test('npm start with no arguments uses the default workspace and port from drawing.json', { timeout: 30_000 }, async () => {
  const h = tempHome();
  const ws = mkdtempSync(join(tmpdir(), 'drawing-e555-ws-'));
  const port = await freePort();
  h.put({ version: 1, workspace: ws, port });
  const env = { PATH: process.env.PATH, HOME: h.home, DRAW_WORKSPACE_WATCH: 'poll' };
  const child = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  try {
    const deadline = Date.now() + 20_000;
    while (!log.includes(`http://127.0.0.1:${port}/`) && Date.now() < deadline && child.exitCode === null) await new Promise((r) => setTimeout(r, 100));
    assert.match(log, new RegExp(`Atelier: http://127\\.0\\.0\\.1:${port}/ +\\(workspace ${ws.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    const info = await (await fetch(`http://127.0.0.1:${port}/api/info`)).json();
    assert.ok(info.workspace);
  } finally {
    child.kill();
    await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
    rmSync(ws, { recursive: true, force: true });
    h.done();
  }
});

test('npm start with no arguments and no default workspace says how to set one', () => {
  const h = tempHome();
  try {
    const out = execFileSync(process.execPath, ['server/index.js'], { env: { PATH: process.env.PATH, HOME: h.home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    assert.fail(`expected exit 1, got ${out}`);
  } catch (e) {
    assert.equal(e.status, 1);
    assert.match(String(e.stderr), /drawing\.json/);
    assert.equal(existsSync(h.file), false);
  } finally {
    h.done();
  }
});
