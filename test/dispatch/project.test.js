// Project mode (E13): workspace inside git, Dispatch off outside git, one server per workspace and
// one Dispatch per project. Scratch git repos in temp dirs; HOME points at a temp dir for the real
// server processes, and no agent CLI is started (no provider is connected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimLock, claimWorkspace, pidAlive } from '../../server/lock.js';
import { claimProject, findProject } from '../../server/dispatch/project.js';
import { gitTop } from '../../server/dispatch/index.js';

const SERVER = fileURLToPath(new URL('../../server/index.js', import.meta.url));

function scratchRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'drawing-e13-')));
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

/** A process that stays alive until killed, and one that has already exited. */
function liveChild() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  return child;
}
async function deadPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((r) => child.on('exit', r));
  return child.pid;
}

/** An HTTP server on a free loopback port answering GET <path> with body. */
async function fakeServer(routes) {
  const srv = createServer((req, res) => {
    const body = routes[req.url];
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, close: () => new Promise((r) => srv.close(r)) };
}

async function freePort() {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

test('findProject: git subfolder and top level count, a plain folder does not', async () => {
  const { root, ws } = scratchRepo();
  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'drawing-e13-plain-')));
  try {
    assert.deepEqual(await findProject(ws, { gitTop }), { root });
    assert.deepEqual(await findProject(root, { gitTop }), { root });
    assert.deepEqual(await findProject(plain, { gitTop }), { reason: 'not-git' });
    assert.deepEqual(await findProject(null, { gitTop }), { reason: 'no-workspace' });
    assert.deepEqual(await findProject(join(plain, 'missing'), { gitTop }), { reason: 'no-workspace' });
    // Inside .git there is no work tree.
    assert.deepEqual(await findProject(join(root, '.git'), { gitTop }), { reason: 'not-git' });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
});

test('findProject: a symlinked workspace resolves to the real project; GIT_DIR from the environment is ignored', async () => {
  const { root, ws } = scratchRepo();
  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'drawing-e13-plain-')));
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  try {
    const link = join(plain, 'ws-link');
    symlinkSync(ws, link);
    assert.deepEqual(await findProject(link, { gitTop }), { root });

    // GIT_DIR / GIT_WORK_TREE inherited from the caller point at another repo B. Without the env
    // filter git would answer B, which does not hold the workspace, and Dispatch would be off.
    const other = scratchRepo();
    try {
      process.env.GIT_DIR = join(other.root, '.git');
      process.env.GIT_WORK_TREE = other.root;
      assert.deepEqual(await findProject(ws, { gitTop }), { root });
      assert.equal(await gitTop(plain), null, 'a plain folder stays plain whatever GIT_DIR says');
    } finally {
      rmSync(other.root, { recursive: true, force: true });
    }
    // A gitTop that answers a folder not holding the workspace is not trusted either.
    assert.deepEqual(await findProject(plain, { gitTop: async () => root }), { reason: 'not-git' });
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(root, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
});

test('claimLock: takes a free lock, refuses a live holder, replaces a dead or impostor holder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e13-lock-'));
  const file = join(dir, 'sub', 'x.lock');
  const child = liveChild();
  try {
    const first = await claimLock(file, { isLive: async () => true });
    assert.equal(first.ok, true);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pid: process.pid, port: null });
    await first.lock.setPort(4567);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pid: process.pid, port: 4567 });
    await first.lock.release();
    assert.equal(existsSync(file), false);

    // Someone else (a live process) holds it.
    writeFileSync(file, JSON.stringify({ pid: child.pid, port: 1234 }));
    const busy = await claimLock(file, { isLive: async (h) => pidAlive(h.pid) });
    assert.deepEqual(busy, { ok: false, holder: { pid: child.pid, port: 1234 } });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, child.pid, 'a refused claim leaves the lock alone');

    // Its pid runs but the port does not answer as that server (pid reused): stale.
    const impostor = await claimLock(file, { isLive: async () => false });
    assert.equal(impostor.ok, true);
    await impostor.lock.release();

    // Holder died (crash, kill -9): stale, replaced.
    writeFileSync(file, JSON.stringify({ pid: await deadPid(), port: 1 }));
    const after = await claimLock(file, { isLive: async (h) => pidAlive(h.pid) });
    assert.equal(after.ok, true);
    // A lock that is no longer ours is not removed by our release.
    writeFileSync(file, JSON.stringify({ pid: child.pid, port: 2 }));
    await after.lock.release();
    after.lock.releaseSync();
    assert.equal(existsSync(file), true);

    // Garbage in the file counts as stale.
    writeFileSync(file, '{not json');
    assert.equal((await claimLock(file, { isLive: async () => true })).ok, true);
    assert.deepEqual(readdirSync(join(dir, 'sub')), ['x.lock'], 'no temp files left behind');
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claimLock: processes racing to replace one stale lock end with exactly one holder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e13-race-'));
  const file = join(dir, 'x.lock');
  const lockUrl = new URL('../../server/lock.js', import.meta.url).href;
  // Each child claims, prints the result, then stays alive (holding or not) until killed. isLive
  // waits a little so every child judges the same stale lock before anyone replaces it.
  const script = `
    const { claimLock, pidAlive } = await import(${JSON.stringify(lockUrl)});
    const res = await claimLock(process.argv[1], {
      isLive: async (h) => { await new Promise((r) => setTimeout(r, 150)); return pidAlive(h.pid); },
    });
    process.stdout.write(res.ok ? 'ok\\n' : 'busy\\n');
    setInterval(() => {}, 1000);`;
  try {
    for (let round = 0; round < 3; round++) {
      writeFileSync(file, JSON.stringify({ pid: await deadPid(), port: 1 }));
      const kids = Array.from({ length: 6 }, () =>
        spawn(process.execPath, ['--input-type=module', '-e', script, file], { stdio: ['ignore', 'pipe', 'inherit'] }));
      const results = await Promise.all(kids.map((k) => new Promise((resolve) => {
        let out = '';
        k.stdout.on('data', (d) => { out += d; if (out.includes('\n')) resolve(out.trim()); });
        k.on('exit', () => resolve(out.trim() || 'exit'));
      })));
      const holder = JSON.parse(readFileSync(file, 'utf8')).pid;
      for (const k of kids) { k.kill(); }
      await Promise.all(kids.map((k) => (k.exitCode !== null ? null : new Promise((r) => k.on('exit', r)))));
      assert.equal(results.filter((r) => r === 'ok').length, 1, `round ${round}: ${results.join(',')}`);
      assert.equal(results[kids.findIndex((k) => k.pid === holder)], 'ok', 'the file names the one that won');
      rmSync(file, { force: true });
    }
    assert.deepEqual(readdirSync(dir), [], 'no temp or break files left behind');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claimWorkspace / claimProject: a symlinked .drawing or .atelier is refused and nothing is written through it', async () => {
  const { root, ws } = scratchRepo();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'drawing-e13-out-')));
  try {
    symlinkSync(outside, join(ws, '.drawing'));
    await assert.rejects(claimWorkspace(ws), { name: 'LockPathError' });
    symlinkSync(outside, join(root, '.atelier'));
    assert.deepEqual(await claimProject(root), { ok: false, reason: 'unsafe', port: null });
    assert.deepEqual(readdirSync(outside), [], 'no lock or temp file outside the workspace');

    // A link to a folder inside the workspace is refused too: the lock folder must be the real one.
    rmSync(join(ws, '.drawing'));
    mkdirSync(join(ws, 'real'));
    symlinkSync(join(ws, 'real'), join(ws, '.drawing'));
    await assert.rejects(claimWorkspace(ws), { name: 'LockPathError' });

    // A link planted at the temp file name is not followed.
    rmSync(join(ws, '.drawing'));
    mkdirSync(join(ws, '.drawing'));
    symlinkSync(join(outside, 'planted'), join(ws, '.drawing', `server.lock.${process.pid}.tmp`));
    const ok = await claimWorkspace(ws);
    assert.equal(ok.ok, true);
    assert.deepEqual(readdirSync(outside), []);
    await ok.lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('claimWorkspace: a live server answering /api/info for this folder holds it', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'drawing-e13-ws-'));
  const name = ws.split('/').pop();
  const child = liveChild();
  const other = await fakeServer({ '/api/info': { workspace: name } });
  const wrong = await fakeServer({ '/api/info': { workspace: 'someone-else' } });
  const file = join(ws, '.drawing', 'server.lock');
  try {
    mkdirSync(join(ws, '.drawing'));
    writeFileSync(file, JSON.stringify({ pid: child.pid, port: other.port }));
    assert.deepEqual(await claimWorkspace(ws), { ok: false, holder: { pid: child.pid, port: other.port } });
    writeFileSync(file, JSON.stringify({ pid: child.pid, port: null }));
    assert.equal((await claimWorkspace(ws)).ok, false, 'a live pid that has not listened yet holds it');
    writeFileSync(file, JSON.stringify({ pid: child.pid, port: wrong.port }));
    const taken = await claimWorkspace(ws);
    assert.equal(taken.ok, true, 'a port serving another workspace means the pid was reused');
    await taken.lock.release();
  } finally {
    child.kill();
    await other.close();
    await wrong.close();
    rmSync(ws, { recursive: true, force: true });
  }
});

test('claimProject: a standalone Dispatch on .atelier/server.port turns Dispatch off and nothing is written', async () => {
  const { root } = scratchRepo();
  const home = process.env.HOME;
  const shown = home && root.startsWith(home) ? root.replace(home, '~') : root;
  const standalone = await fakeServer({ '/api/state': { project: { path: shown } } });
  const elsewhere = await fakeServer({ '/api/state': { project: { path: '/somewhere/else' } } });
  try {
    mkdirSync(join(root, '.atelier'));
    writeFileSync(join(root, '.atelier', 'server.port'), `${standalone.port}\n`);
    assert.deepEqual(await claimProject(root), { ok: false, reason: 'standalone', port: standalone.port });
    assert.deepEqual(readdirSync(join(root, '.atelier')), ['server.port']);

    // The remembered port now serves another project, or nothing: not ours to worry about.
    writeFileSync(join(root, '.atelier', 'server.port'), `${elsewhere.port}\n`);
    const ok = await claimProject(root);
    assert.equal(ok.ok, true);
    await ok.lock.release();
    writeFileSync(join(root, '.atelier', 'server.port'), `${await freePort()}\n`);
    const ok2 = await claimProject(root);
    assert.equal(ok2.ok, true);
    await ok2.lock.release();
  } finally {
    await standalone.close();
    await elsewhere.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimProject: another live Drawing server holding .atelier/drawing.lock turns Dispatch off', async () => {
  const { root } = scratchRepo();
  const child = liveChild();
  const drawing = await fakeServer({ '/api/state': { project: { path: root } } });
  try {
    mkdirSync(join(root, '.atelier'));
    writeFileSync(join(root, '.atelier', 'drawing.lock'), JSON.stringify({ pid: child.pid, port: drawing.port }));
    assert.deepEqual(await claimProject(root), { ok: false, reason: 'other-drawing', port: drawing.port });
    child.kill();
    await new Promise((r) => child.on('exit', r));
    const ok = await claimProject(root);
    assert.equal(ok.ok, true, 'the holder exited: its lock is stale');
    await ok.lock.release();
  } finally {
    child.kill();
    await drawing.close();
    rmSync(root, { recursive: true, force: true });
  }
});

/** The lock's content once its port is recorded; polls up to 5 s. */
async function lockOnceSet(file, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let h = null;
    try {
      h = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      /* not there yet, or mid-rename */
    }
    if (h?.port != null || Date.now() > end) return h;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Starts the real server (node server/index.js) on a free port; resolves once it prints its URL or exits. */
async function startServer(ws, home) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER, ws], {
    env: { PATH: process.env.PATH, HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 10_000);
    child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
    child.stdout.on('data', () => { if (out.includes('Atelier: http://')) { clearTimeout(timer); resolve(null); } });
  });
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise((r) => child.on('exit', r));
  };
  return { port, child, code, output: () => out, stop, base: `http://127.0.0.1:${port}` };
}

test('real server: a second server on the same workspace refuses; a second workspace in the project runs without Dispatch', async () => {
  const { root, ws } = scratchRepo();
  const home = mkdtempSync(join(tmpdir(), 'drawing-e13-home-'));
  const docs = join(root, 'docs');
  mkdirSync(docs);
  const servers = [];
  try {
    const a = await startServer(ws, home);
    servers.push(a);
    assert.equal(a.code, null, a.output());
    assert.deepEqual(await (await fetch(`${a.base}/api/dispatch`)).json(), { enabled: true });
    assert.equal((await fetch(`${a.base}/api/state`)).status, 200);
    // listening() records the port in both locks shortly after the URL line.
    const want = { pid: a.child.pid, port: a.port };
    assert.deepEqual(await lockOnceSet(join(ws, '.drawing', 'server.lock')), want);
    assert.deepEqual(await lockOnceSet(join(root, '.atelier', 'drawing.lock')), want);

    const b = await startServer(ws, home);
    servers.push(b);
    assert.equal(b.code, 1);
    assert.match(b.output(), new RegExp(`Another Atelier server is already running for this workspace: http://127.0.0.1:${a.port}/`));

    const c = await startServer(docs, home);
    servers.push(c);
    assert.equal(c.code, null, c.output());
    const status = await (await fetch(`${c.base}/api/dispatch`)).json();
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'other-drawing');
    assert.equal(status.port, a.port);
    assert.match(status.message, /다른 Drawing 서버/);
    assert.equal((await fetch(`${c.base}/api/state`)).status, 404);
    assert.equal((await fetch(`${c.base}/api/workspace/projects`)).status, 200, 'drawing still works');
    const extra = c.output().split('\n').filter((l) => !l.startsWith('Atelier: '));
    assert.ok(!extra.some((l) => l.includes(root)), 'no project path in the log besides the workspace line');

    // Stopping the first server frees both locks.
    await a.stop();
    assert.equal(existsSync(join(ws, '.drawing', 'server.lock')), false);
    assert.equal(existsSync(join(root, '.atelier', 'drawing.lock')), false);
    const d = await startServer(ws, home);
    servers.push(d);
    assert.equal(d.code, null, d.output());
  } finally {
    for (const s of servers) await s.stop();
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('real server: outside git Dispatch is off with a reason, and a stale lock from a crash does not block', async () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'drawing-e13-nogit-')));
  const home = mkdtempSync(join(tmpdir(), 'drawing-e13-home-'));
  let s;
  try {
    mkdirSync(join(ws, '.drawing'));
    writeFileSync(join(ws, '.drawing', 'server.lock'), JSON.stringify({ pid: await deadPid(), port: 4330 }));
    s = await startServer(ws, home);
    assert.equal(s.code, null, s.output());
    const status = await (await fetch(`${s.base}/api/dispatch`)).json();
    assert.deepEqual(Object.keys(status).sort(), ['enabled', 'message', 'reason']);
    assert.equal(status.reason, 'not-git');
    assert.match(s.output(), /Dispatch off: not-git/);
    assert.equal((await fetch(`${s.base}/api/state`)).status, 404);
    assert.equal(existsSync(join(ws, '.atelier')), false);
  } finally {
    await s?.stop();
    rmSync(ws, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('claimProject: a live .break holder that never lets go turns Dispatch off instead of throwing', async () => {
  const { root } = scratchRepo();
  const child = liveChild();
  try {
    mkdirSync(join(root, '.atelier'));
    // A stale lock (dead pid) forces a break; a live process holds .break the whole time.
    writeFileSync(join(root, '.atelier', 'drawing.lock'), JSON.stringify({ pid: 2 ** 22 + 12345 }));
    writeFileSync(join(root, '.atelier', 'drawing.lock.break'), JSON.stringify({ pid: child.pid }));
    assert.deepEqual(await claimProject(root), { ok: false, reason: 'lock-busy', port: null });
  } finally {
    child.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimProject: a dead .break holder is cleared and the stale lock is taken', async () => {
  const { root } = scratchRepo();
  try {
    mkdirSync(join(root, '.atelier'));
    writeFileSync(join(root, '.atelier', 'drawing.lock'), JSON.stringify({ pid: 2 ** 22 + 12345 }));
    writeFileSync(join(root, '.atelier', 'drawing.lock.break'), JSON.stringify({ pid: 2 ** 22 + 54321 }));
    const res = await claimProject(root);
    assert.equal(res.ok, true);
    await res.lock.release();
    assert.equal(existsSync(join(root, '.atelier', 'drawing.lock.break')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('git calls ignore GIT_DIR / GIT_WORK_TREE inherited from the server environment', async () => {
  const { root } = scratchRepo();
  const other = scratchRepo();
  execFileSync('git', ['-C', other.root, 'checkout', '-q', '-b', 'other-branch']);
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  try {
    process.env.GIT_DIR = join(other.root, '.git');
    process.env.GIT_WORK_TREE = other.root;
    const { currentBranch, projectRoot } = await import('../../server/dispatch/git.js');
    assert.equal(await currentBranch(root), 'develop');
    assert.equal(await projectRoot(root), root);
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    rmSync(root, { recursive: true, force: true });
    rmSync(other.root, { recursive: true, force: true });
  }
});
