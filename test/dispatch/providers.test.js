// Model connection (E525, #570): the real auth.js against the fake `claude auth login|logout|status`.
// Contract: docs/design/model-connection-contract.md. Scratch git repo in a temp dir; no real claude.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.js';
import * as workspace from '../../server/workspace/index.js';
import * as dispatch from '../../server/dispatch/index.js';
import { cancelLogin, login, loginProcForTest } from '../../server/dispatch/auth.js';
import { fakeCliBin, until } from '../fixtures/fake-cli/index.mjs';
import { FAKE_MARKER } from '../../server/dispatch/cli.js';

const W = { 'content-type': 'application/json', 'x-drawing': '1' };
const ORIGINAL = { ...process.env };
const fake = fakeCliBin();
after(() => { process.env = ORIGINAL; fake.cleanup(); });

function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'drawing-e525-'));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(root, 'workspace');
  mkdirSync(ws);
  return { root, ws };
}

/** Starts Drawing with the real provider code; `env` goes into process.env (the CLI seam reads it). */
async function start(env) {
  process.env = { ...ORIGINAL, ...env };
  const { root, ws } = scratchRepo();
  const moduleList = [
    { name: 'workspace', setup: workspace.setup },
    { name: 'dispatch', setup: (ctx) => dispatch.setup(ctx, { limitsFile: join(root, 'limits.json') }) },
  ];
  const pub = mkdtempSync(join(tmpdir(), 'drawing-e525-pub-'));
  writeFileSync(join(pub, 'index.html'), '<!doctype html>');
  const app = await createApp({ workspaceDir: ws }, { publicDir: pub, moduleList });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (path, body = {}) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: W, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const claude = async () => (await (await fetch(`${base}/api/state`)).json()).providers.claude;
  const stop = async () => {
    if (!closed) await app.close();
    rmSync(pub, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  };
  let closed = false;
  const close = async () => { closed = true; await app.close(); };
  return { base, post, claude, stop, close, root };
}

const withFake = (dir, extra = {}) => ({
  PATH: `${fake.dir}:${ORIGINAL.PATH}`,
  FAKE_CLI_LOG: fake.log,
  FAKE_CLI_AUTH: join(dir, 'auth-state'),
  ...extra,
});

test('not checked before connect; login runs the CLI login, shows busy + URL, then connects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e525-auth-'));
  const s = await start(withFake(dir, { FAKE_CLI_LOGIN_MS: '400' }));
  try {
    const before = await s.claude();
    assert.equal(before.installed, null);
    assert.equal(before.connected, false);
    assert.equal(fake.calls().length, 0, 'no CLI before the user connects');

    // The SSE stream carries every providers change.
    const ac = new AbortController();
    const events = [];
    const sse = fetch(`${s.base}/api/events`, { signal: ac.signal }).then(async (res) => {
      const dec = new TextDecoder();
      for await (const chunk of res.body) {
        for (const m of dec.decode(chunk).matchAll(/event: providers\ndata: (.*)\n/g)) events.push(JSON.parse(m[1]));
      }
    }).catch(() => {});

    const res = await s.post('/api/providers/claude/login');
    assert.deepEqual(res.body, { ok: true, connected: false });
    const busy = await until(async () => { const p = await s.claude(); return p.busy && p.url ? p : null; });
    assert.equal(busy.url, 'https://login.example.invalid/oauth?fake=1');
    assert.equal(busy.installed, true);
    // A second login while busy starts nothing new.
    assert.deepEqual((await s.post('/api/providers/claude/login')).body, { ok: true, connected: false });

    const done = await until(async () => { const p = await s.claude(); return !p.busy && p.connected ? p : null; });
    assert.equal(done.error, null);
    assert.equal(done.url, null);
    assert.equal(done.cliLoggedIn, true);
    assert.equal(done.keySupported, false);
    assert.ok(!('proc' in done) && !('cancelled' in done));
    assert.equal(fake.calls().filter((c) => c.args.join(' ') === 'auth login').length, 1);

    await until(() => events.some((p) => p.claude.busy) && events.some((p) => p.claude.connected));
    ac.abort();
    await sse;
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancel stops the login without an error; logout disconnects and reconnect is instant', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e525-auth-'));
  const s = await start(withFake(dir, { FAKE_CLI_LOGIN_MS: '10000' }));
  try {
    await s.post('/api/providers/claude/login');
    await until(async () => (await s.claude()).busy);
    assert.deepEqual((await s.post('/api/providers/claude/cancel')).body, { ok: true });
    const off = await until(async () => { const p = await s.claude(); return p.busy ? null : p; });
    assert.equal(off.error, null, 'a cancel is not an error');
    assert.equal(off.connected, false);
    assert.equal(off.url, null);
    // Cancel with nothing running is a no-op.
    assert.deepEqual((await s.post('/api/providers/claude/cancel')).body, { ok: true });

    // CLI logged in on the machine → connect at once, no browser login.
    writeFileSync(join(dir, 'auth-state'), 'fake\n');
    assert.deepEqual((await s.post('/api/providers/claude/login')).body, { ok: true, connected: true });
    assert.equal((await s.claude()).connected, true);

    // Disconnect from Drawing only: the CLI stays logged in.
    assert.deepEqual((await s.post('/api/providers/claude/logout')).body, { ok: true });
    const out = await s.claude();
    assert.equal(out.connected, false);
    assert.equal(out.cliLoggedIn, true);
    assert.deepEqual((await s.post('/api/providers/claude/login')).body, { ok: true, connected: true });

    // cli: true also logs the CLI out.
    await s.post('/api/providers/claude/logout', { cli: true });
    const gone = await s.claude();
    assert.equal(gone.connected, false);
    assert.equal(gone.cliLoggedIn, false);
    assert.ok(fake.calls().some((c) => c.args.join(' ') === 'auth logout'));
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed login shows an error and stays disconnected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e525-auth-'));
  const s = await start(withFake(dir, { FAKE_CLI_LOGIN_MS: '50', FAKE_CLI_LOGIN_EXIT: '1' }));
  try {
    await s.post('/api/providers/claude/login');
    const p = await until(async () => { const c = await s.claude(); return c.error ? c : null; });
    assert.equal(p.busy, false);
    assert.equal(p.connected, false);
    assert.match(p.error, /로그인이 끝나지 않았어요/);
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claude not installed: login answers 400 and installed turns false', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'drawing-e525-nobin-'));
  // git only: no fake (and the CLI seam refuses a real claude under test).
  const gitDir = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim().replace(/\/git$/, '');
  const s = await start({ PATH: `${empty}:${gitDir}` });
  try {
    const res = await s.post('/api/providers/claude/login');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Claude CLI를 찾지 못했어요/);
    const p = await s.claude();
    assert.equal(p.installed, false);
    assert.equal(p.busy, false);
  } finally {
    await s.stop();
    rmSync(empty, { recursive: true, force: true });
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enabledOnDisk = (root) => {
  const file = join(root, '.atelier', 'state.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).settings?.enabled?.claude : undefined;
};

test('server close cancels a running login: the CLI never logs in and nothing is saved after close', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e525-auth-'));
  const s = await start(withFake(dir, { FAKE_CLI_LOGIN_MS: '1500' }));
  try {
    await s.post('/api/providers/claude/login');
    await until(async () => (await s.claude()).busy);
    await s.close();
    // The fake would write auth-state at 1.5 s if it were still alive.
    await sleep(2000);
    assert.equal(existsSync(join(dir, 'auth-state')), false, 'login child gone');
    assert.notEqual(enabledOnDisk(s.root), true, 'no connect saved after close');
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('logout during a running login cancels it, so it does not connect when it would have finished', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e525-auth-'));
  const s = await start(withFake(dir, { FAKE_CLI_LOGIN_MS: '1500' }));
  try {
    await s.post('/api/providers/claude/login');
    await until(async () => (await s.claude()).busy);
    assert.deepEqual((await s.post('/api/providers/claude/logout')).body, { ok: true });
    const out = await s.claude();
    assert.equal(out.busy, false, 'login stopped before logout answers');
    assert.equal(out.error, null);
    await sleep(2000);
    const later = await s.claude();
    assert.equal(later.connected, false);
    assert.equal(later.busy, false);
    assert.equal(existsSync(join(dir, 'auth-state')), false);
    assert.notEqual(enabledOnDisk(s.root), true);
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancel kills a login that ignores SIGTERM', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e525-auth-'));
  const s = await start(withFake(dir, { FAKE_CLI_LOGIN_MS: '10000', FAKE_CLI_LOGIN_IGNORE_TERM: '1' }));
  try {
    await s.post('/api/providers/claude/login');
    // Wait for the URL: the fake installs its SIGTERM handler before printing it.
    await until(async () => (await s.claude()).url);
    const t0 = Date.now();
    await cancelLogin('claude', 200);
    assert.ok(Date.now() - t0 < 2500, 'SIGKILL ended it before the 3 s default');
    // /api/state follows the async providers refresh.
    const p = await until(async () => { const c = await s.claude(); return c.busy ? null : c; });
    assert.equal(p.busy, false);
    assert.equal(p.error, null);
    assert.equal(p.connected, false);
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A marked fake bin folder whose `claude` cannot start (its interpreter does not exist): spawn emits `error`, never `exit`. */
function brokenClaudeBin() {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-login-broken-'));
  writeFileSync(join(dir, 'claude'), '#!/nonexistent/interpreter\n', { mode: 0o755 });
  writeFileSync(join(dir, FAKE_MARKER), '');
  return dir;
}

test('#590 cancel right after a login that fails to spawn resolves at once and shows no error', async () => {
  const dir = brokenClaudeBin();
  process.env = { ...ORIGINAL, PATH: dir };
  try {
    let done = null;
    login('claude', () => {}, (ok) => { done = ok; });
    const t0 = Date.now();
    await Promise.race([cancelLogin('claude', 60_000), new Promise((_, rej) => setTimeout(() => rej(new Error('cancelLogin hung')), 2000))]);
    assert.ok(Date.now() - t0 < 2000);
    await until(() => loginProcForTest('claude') === null);
    assert.equal(done, null, 'a spawn failure is not a finished login');
  } finally {
    process.env = ORIGINAL;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#590 a child error after spawn (e.g. a failed kill) keeps the login; its exit still ends it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-login-err-'));
  process.env = { ...ORIGINAL, ...withFake(dir, { FAKE_CLI_LOGIN_MS: '200' }) };
  try {
    let done = null;
    login('claude', () => {}, (ok) => { done = ok; });
    const p = loginProcForTest('claude');
    assert.ok(p?.pid);
    p.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' }));
    assert.equal(loginProcForTest('claude'), p, 'still the running login');
    await until(() => done !== null);
    assert.equal(done, true, 'onDone ran on exit');
  } finally {
    process.env = ORIGINAL;
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------- Codex and Gemini (#587) ---------------- */

const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name));

test('#587 Codex API key: goes to the CLI stdin only, never into args, logs, files or the answer; models load once after connect', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-587-key-'));
  const KEY = 'sk-test-NEVER-STORE-587';
  const logged = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...a) => { logged.push(a.map(String).join(' ')); };
  const s = await start(withFake(dir));
  const c0 = fake.calls().length;
  const calls = () => fake.calls().slice(c0);
  try {
    const state = async () => (await fetch(`${s.base}/api/state`)).json();
    assert.equal((await state()).models.some((m) => m.provider === 'openai'), false, 'no Codex models before connect');
    assert.equal(calls().filter((c) => c.bin === 'codex').length, 0);

    const empty = await s.post('/api/providers/openai/key', { key: '  ' });
    assert.equal(empty.status, 400);
    assert.equal(calls().filter((c) => c.bin === 'codex' && c.args[0] === 'login' && c.args[1] === '--with-api-key').length, 0);

    const res = await s.post('/api/providers/openai/key', { key: KEY });
    assert.deepEqual(res.body, { ok: true, connected: true });
    const st = await state();
    assert.equal(st.providers.openai.connected, true);
    assert.ok(st.models.some((m) => m.id === 'gpt-fake-codex'));
    assert.equal(st.models.some((m) => m.id === 'gpt-fake-hidden'), false);
    await s.post('/api/providers/refresh');
    const debug = calls().filter((c) => c.bin === 'codex' && c.args.join(' ') === 'debug models');
    assert.equal(debug.length, 1, 'Codex models asked once');

    const keyLogin = calls().filter((c) => c.args.join(' ') === 'login --with-api-key');
    assert.equal(keyLogin.length, 1);
    assert.equal(JSON.stringify(calls()).includes(KEY), false, 'key not in any CLI args');
    assert.equal(JSON.stringify(st).includes(KEY), false);
    assert.equal(logged.some((l) => l.includes(KEY)), false, 'key not logged');
    for (const f of [...filesUnder(s.root), ...filesUnder(dir)]) {
      assert.equal(readFileSync(f, 'utf8').includes(KEY), false, `key written to ${f}`);
    }
    // The other providers' login routes exist too: agy has no status command, so an installed agy connects at once.
    assert.deepEqual((await s.post('/api/providers/gemini/login')).body, { ok: true, connected: true });
    assert.equal((await state()).providers.gemini.connected, true);
    assert.equal((await s.post('/api/providers/claude/key', { key: KEY })).status, 404, 'no key route for Claude');
  } finally {
    Object.assign(console, orig);
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#1023 account email: from `claude auth status` after connect, null again after CLI logout, never in state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e525-auth-'));
  writeFileSync(join(dir, 'auth-state'), 'claude');
  const s = await start(withFake(dir));
  const accounts = async () => (await (await fetch(`${s.base}/api/providers/accounts`)).json()).accounts;
  const calls0 = fake.calls().length;
  try {
    assert.deepEqual(await accounts(), { claude: null, openai: null, gemini: null });
    assert.equal(fake.calls().length, calls0, 'no CLI before the user connects');
    assert.deepEqual((await s.post('/api/providers/claude/login')).body, { ok: true, connected: true });
    assert.equal((await accounts()).claude, 'fake@example.invalid');
    assert.ok(!(await (await fetch(`${s.base}/api/state`)).text()).includes('@example.invalid'));
    assert.equal((await s.post('/api/providers/claude/logout', { cli: true })).status, 200);
    assert.equal((await accounts()).claude, null);
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
