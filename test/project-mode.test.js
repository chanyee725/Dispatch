// Other-project mode (E30a): --project-mode flag, /api/info mode, and plugin/scripts/start.sh.
// Everything runs in a temp dir with a scratch git repo; no agent CLI is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { parseArgs } from '../server/cli.js';

const START = new URL('../plugin/scripts/start.sh', import.meta.url).pathname;

test('parseArgs: --project-mode flag and DRAW_MODE', () => {
  assert.equal(parseArgs(['/w'], {}).projectMode, false);
  assert.equal(parseArgs(['--project-mode', '/w'], {}).projectMode, true);
  assert.equal(parseArgs(['/w'], { DRAW_MODE: 'project' }).projectMode, true);
  assert.throws(() => parseArgs(['--nope', '/w'], {}), /Unknown option/);
});

test('/api/info reports the mode and the project folder name', async () => {
  for (const [projectMode, mode, project] of [[false, 'drawing', null], [true, 'project', 'proj']]) {
    const app = await createApp({ workspaceDir: '/tmp/proj/.atelier', projectMode }, { moduleList: [] });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    try {
      const info = await (await fetch(`http://127.0.0.1:${app.server.address().port}/api/info`)).json();
      assert.equal(info.mode, mode);
      assert.equal(info.project, project);
    } finally {
      await app.close();
    }
  }
});

test('start.sh starts project mode on <project>/.atelier, remembers the port and reuses the server', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30a-'));
  const project = join(dir, 'proj');
  const home = join(dir, 'home');
  execFileSync('mkdir', ['-p', project, home]);
  const git = (...a) => execFileSync('git', ['-C', project, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(project, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const env = { ...process.env, HOME: home, DISPATCH_PORT: '', DRAW_PORT: '' };
  const run = () => spawnSync('bash', [START, project], { env, encoding: 'utf8' });
  let port = null;
  try {
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    port = readFileSync(join(project, '.atelier', 'server.port'), 'utf8').trim();
    assert.equal(first.stdout.trim(), `http://127.0.0.1:${port}/`);
    assert.ok(existsSync(join(project, '.atelier')));
    // First start: no "server.port: No such file" noise, and .atelier/ is kept out of git locally.
    assert.equal(first.stderr, '');
    const exclude = () => readFileSync(join(project, '.git', 'info', 'exclude'), 'utf8');
    assert.equal(exclude().split('\n').filter((l) => l === '.atelier/').length, 1);
    assert.equal(git('status', '--porcelain'), '');
    const pid = Number(readFileSync(join(project, '.atelier', 'server.pid'), 'utf8'));
    assert.doesNotThrow(() => process.kill(pid, 0), 'server.pid names the running server');
    const info = await (await fetch(`http://127.0.0.1:${port}/api/info`)).json();
    assert.deepEqual(info, { workspace: '.atelier', mode: 'project', project: 'proj' });
    // Second call reuses the running server: same port, no new process.
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout.trim(), first.stdout.trim());
    assert.equal(readFileSync(join(project, '.atelier', 'server.port'), 'utf8').trim(), port);
    assert.equal(Number(readFileSync(join(project, '.atelier', 'server.pid'), 'utf8')), pid);
    assert.equal(exclude().split('\n').filter((l) => l === '.atelier/').length, 1, 'exclude entry is not repeated');
    // Reuse rewrites a dropped or stale server.pid (#378), so stop.sh/update.sh still find the server.
    rmSync(join(project, '.atelier', 'server.pid'));
    assert.equal(run().status, 0);
    assert.equal(Number(readFileSync(join(project, '.atelier', 'server.pid'), 'utf8')), pid);
    writeFileSync(join(project, '.atelier', 'server.pid'), '1\n');
    assert.equal(run().status, 0);
    assert.equal(Number(readFileSync(join(project, '.atelier', 'server.pid'), 'utf8')), pid);
  } finally {
    if (port) {
      try {
        const lock = JSON.parse(readFileSync(join(project, '.atelier', '.drawing', 'server.lock'), 'utf8'));
        process.kill(lock.pid, 'SIGTERM');
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start.sh honors DISPATCH_PORT when it is free and stop.sh-style kill by server.pid ends it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30a-'));
  const project = join(dir, 'proj');
  execFileSync('mkdir', ['-p', project, join(dir, 'home')]);
  const git = (...a) => execFileSync('git', ['-C', project, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(project, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const want = probe.address().port;
  await new Promise((r) => probe.close(r));
  const r = spawnSync('bash', [START, project], { env: { ...process.env, HOME: join(dir, 'home'), DRAW_PORT: '', DISPATCH_PORT: String(want) }, encoding: 'utf8' });
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), `http://127.0.0.1:${want}/`);
  } finally {
    try { process.kill(Number(readFileSync(join(project, '.atelier', 'server.pid'), 'utf8')), 'SIGTERM'); } catch {}
    await new Promise((res) => setTimeout(res, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start.sh: DRAW_PORT wins over DISPATCH_PORT', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30a-'));
  const project = join(dir, 'proj');
  execFileSync('mkdir', ['-p', project, join(dir, 'home')]);
  const git = (...a) => execFileSync('git', ['-C', project, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(project, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const free = async () => {
    const s = createServer();
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const p = s.address().port;
    await new Promise((r) => s.close(r));
    return p;
  };
  const [a, b] = [await free(), await free()];
  const r = spawnSync('bash', [START, project], { env: { ...process.env, HOME: join(dir, 'home'), DRAW_PORT: String(a), DISPATCH_PORT: String(b) }, encoding: 'utf8' });
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), `http://127.0.0.1:${a}/`);
    assert.equal(existsSync(join(dir, 'home', '.dispatch', 'servers')), false, 'no registry written');
  } finally {
    try { process.kill(Number(readFileSync(join(project, '.atelier', 'server.pid'), 'utf8')), 'SIGTERM'); } catch {}
    await new Promise((res) => setTimeout(res, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("start.sh does not reuse another project's server that took the remembered port", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30a-'));
  const home = join(dir, 'home');
  execFileSync('mkdir', ['-p', home]);
  const makeProject = (name) => {
    const project = join(dir, name);
    execFileSync('mkdir', ['-p', project]);
    const git = (...a) => execFileSync('git', ['-C', project, ...a], { encoding: 'utf8' });
    git('init', '-q', '-b', 'develop');
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(project, 'README.md'), 'scratch\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    return project;
  };
  const a = makeProject('a');
  const b = makeProject('b');
  const fakeCli = new URL('./fixtures/fake-cli', import.meta.url).pathname;
  const env = (port = '') => ({ ...process.env, HOME: home, PATH: `${fakeCli}:${process.env.PATH}`, DISPATCH_PORT: '', DRAW_PORT: port });
  const start = (project, port) => spawnSync('bash', [START, project], { env: env(port), encoding: 'utf8' });
  const lockPid = (project) => JSON.parse(readFileSync(join(project, '.atelier', '.drawing', 'server.lock'), 'utf8')).pid;
  const pids = new Set();
  try {
    const first = start(a);
    assert.equal(first.status, 0, first.stderr);
    const port = readFileSync(join(a, '.atelier', 'server.port'), 'utf8').trim();
    // Kill A hard: its lock stays behind, naming the port with a dead pid.
    const pidA = Number(readFileSync(join(a, '.atelier', 'server.pid'), 'utf8'));
    process.kill(pidA, 'SIGKILL');
    for (let i = 0; i < 50; i++) {
      try { process.kill(pidA, 0); } catch { break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    // B takes A's old port.
    const other = start(b, port);
    assert.equal(other.status, 0, other.stderr);
    assert.equal(other.stdout.trim(), `http://127.0.0.1:${port}/`);
    pids.add(lockPid(b));
    // A again: B answers on the remembered port as project mode on ".atelier", but it is not ours.
    const again = start(a);
    assert.equal(again.status, 0, again.stderr);
    pids.add(lockPid(a));
    assert.notEqual(again.stdout.trim(), `http://127.0.0.1:${port}/`, "reused another project's server");
    const newPort = readFileSync(join(a, '.atelier', 'server.port'), 'utf8').trim();
    assert.notEqual(newPort, port);
    assert.equal(again.stdout.trim(), `http://127.0.0.1:${newPort}/`);
    const lockA = JSON.parse(readFileSync(join(a, '.atelier', '.drawing', 'server.lock'), 'utf8'));
    assert.equal(String(lockA.port), newPort);
    assert.equal(lockA.pid, Number(readFileSync(join(a, '.atelier', 'server.pid'), 'utf8')));
    // And A's own live server is still reused.
    const reuse = start(a);
    assert.equal(reuse.status, 0, reuse.stderr);
    assert.equal(reuse.stdout.trim(), again.stdout.trim());
  } finally {
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start.sh refuses a folder that is not a git project top', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30a-'));
  try {
    const r = spawnSync('bash', [START, dir], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Not a git project/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- pid-file safety and write order (fake processes only) ---

const STOP = new URL('../plugin/skills/atelier-setup/scripts/stop.sh', import.meta.url).pathname;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitDead = async (pid) => { for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100)); };

function scratchProject() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'drawing-pid-')));
  const project = join(dir, 'proj');
  execFileSync('mkdir', ['-p', join(project, '.atelier')]);
  execFileSync('git', ['init', '-q', project]);
  return { dir, project };
}

test('stop.sh signals only node running a Drawing server for this project; anything else is a stale pid file', async () => {
  const { dir, project } = scratchProject();
  const pidFile = join(project, '.atelier', 'server.pid');
  mkdirSync(join(dir, 'fake/server'), { recursive: true });
  writeFileSync(join(dir, 'fake/server/index.js'), 'setInterval(() => {}, 1000);\n');
  const ours = spawn(process.execPath, [join(dir, 'fake/server/index.js'), '--project-mode', join(project, '.atelier')], { stdio: 'ignore' });
  const elsewhere = spawn(process.execPath, [join(dir, 'fake/server/index.js'), '--project-mode', join(dir, 'other/.atelier')], { stdio: 'ignore' });
  const unrelated = spawn('sleep', ['60'], { stdio: 'ignore' });
  const stop = () => spawnSync('bash', [STOP, project], { encoding: 'utf8' });
  try {
    for (const p of [elsewhere, unrelated]) {
      writeFileSync(pidFile, String(p.pid));
      const r = stop();
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /No Dispatch server running/);
      assert.ok(alive(p.pid), 'foreign process must not be signalled');
      assert.ok(!existsSync(pidFile), 'stale pid file removed');
    }
    writeFileSync(pidFile, String(ours.pid));
    const r = stop();
    assert.match(r.stdout, /Dispatch stopped/);
    await waitDead(ours.pid);
    assert.ok(!alive(ours.pid));
  } finally {
    for (const p of [ours, elsewhere, unrelated]) p.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stop.sh recognizes a server whose node path and workspace path contain spaces', async () => {
  const { dir, project } = scratchProject();
  const pidFile = join(project, '.atelier', 'server.pid');
  mkdirSync(join(dir, 'fake/server'), { recursive: true });
  mkdirSync(join(dir, 'bin with space'), { recursive: true });
  symlinkSync(process.execPath, join(dir, 'bin with space', 'node'));
  writeFileSync(join(dir, 'fake/server/index.js'), 'setInterval(() => {}, 1000);\n');
  const ours = spawn(join(dir, 'bin with space', 'node'), [join(dir, 'fake/server/index.js'), '--project-mode', join(project, '.atelier')], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(pidFile, String(ours.pid));
    const r = spawnSync('bash', [STOP, project], { encoding: 'utf8' });
    assert.match(r.stdout, /Dispatch stopped/);
    await waitDead(ours.pid);
    assert.ok(!alive(ours.pid));
  } finally {
    ours.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update.sh and stop.sh share one is_our_server (no duplicate definition) that uses ps -ww', () => {
  const root = new URL('../plugin/', import.meta.url).pathname;
  const lib = readFileSync(join(root, 'scripts/server-check.sh'), 'utf8');
  assert.match(lib, /ps -ww -o command=/);
  for (const f of ['skills/atelier-setup/scripts/stop.sh', 'skills/atelier-update/scripts/update.sh']) {
    const t = readFileSync(join(root, f), 'utf8');
    assert.ok(!/^is_our_server\(\)/m.test(t), f + ' must not define its own');
    assert.match(t, /server-check\.sh/);
  }
});

test('restart.sh waits for the old server to exit before starting', async () => {
  const { dir, project } = scratchProject();
  const home = join(dir, 'home');
  mkdirSync(join(home, 'plugin/scripts'), { recursive: true });
  mkdirSync(join(home, 'plugin/skills/atelier-setup/scripts'), { recursive: true });
  mkdirSync(join(dir, 'fake/server'), { recursive: true });
  for (const f of ['skills/atelier-setup/scripts/restart.sh', 'skills/atelier-setup/scripts/stop.sh', 'scripts/server-check.sh']) {
    copyFileSync(new URL('../plugin/' + f, import.meta.url), join(home, 'plugin', f));
  }
  // Old server ignores SIGTERM for ~2s, then exits. The fake start.sh records whether it was still alive.
  writeFileSync(join(dir, 'fake/server/index.js'), "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 2000)); setInterval(() => {}, 1000);\n");
  writeFileSync(join(home, 'plugin/scripts/start.sh'), '#!/bin/sh\ns=$(ps -o stat= -p "$OLDPID" 2>/dev/null)\ncase "$s" in ""|Z*) echo dead > "$OUT" ;; *) echo alive > "$OUT" ;; esac\n');
  execFileSync('chmod', ['+x', join(home, 'plugin/scripts/start.sh')]);
  const ours = spawn(process.execPath, [join(dir, 'fake/server/index.js'), '--project-mode', join(project, '.atelier')], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(project, '.atelier', 'server.pid'), String(ours.pid));
    const out = join(dir, 'out');
    const r = spawnSync('bash', [join(home, 'plugin/skills/atelier-setup/scripts/restart.sh'), project], { env: { ...process.env, OLDPID: String(ours.pid), OUT: out }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(out, 'utf8').trim(), 'dead');
  } finally {
    ours.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

function restartFixture(dir) {
  const home = join(dir, 'home');
  mkdirSync(join(home, 'plugin/scripts'), { recursive: true });
  mkdirSync(join(home, 'plugin/skills/atelier-setup/scripts'), { recursive: true });
  for (const f of ['skills/atelier-setup/scripts/restart.sh', 'skills/atelier-setup/scripts/stop.sh', 'scripts/server-check.sh']) {
    copyFileSync(new URL('../plugin/' + f, import.meta.url), join(home, 'plugin', f));
  }
  writeFileSync(join(home, 'plugin/scripts/start.sh'), '#!/bin/sh\necho started > "$OUT"\n');
  execFileSync('chmod', ['+x', join(home, 'plugin/scripts/start.sh')]);
  return join(home, 'plugin/skills/atelier-setup/scripts/restart.sh');
}

test('restart.sh starts at once when server.pid points at a live pid that is not our server', async () => {
  const { dir, project } = scratchProject();
  const restart = restartFixture(dir);
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(project, '.atelier', 'server.pid'), String(other.pid));
    const out = join(dir, 'out');
    const t0 = Date.now();
    const r = spawnSync('bash', [restart, project], { env: { ...process.env, OUT: out }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(Date.now() - t0 < 5000, 'did not wait for the unrelated pid');
    assert.equal(readFileSync(out, 'utf8').trim(), 'started');
    assert.ok(alive(other.pid), 'unrelated process left alone');
  } finally {
    other.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restart.sh aborts without starting when our server ignores SIGTERM', async () => {
  const { dir, project } = scratchProject();
  const restart = restartFixture(dir);
  mkdirSync(join(dir, 'fake dir/server'), { recursive: true });
  writeFileSync(join(dir, 'fake dir/server/index.js'), "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n");
  const ours = spawn(process.execPath, [join(dir, 'fake dir/server/index.js'), '--project-mode', join(project, '.atelier')], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(project, '.atelier', 'server.pid'), String(ours.pid));
    const out = join(dir, 'out');
    const r = spawnSync('bash', [restart, project], { env: { ...process.env, OUT: out, DRAW_RESTART_WAIT_TENTHS: '20' }, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /did not exit within the wait/);
    assert.ok(!existsSync(out), 'start.sh not called');
  } finally {
    ours.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start.sh writes server.pid only after the server is ready; a failed start keeps the old file', () => {
  const { dir, project } = scratchProject();
  const fakeHome = join(dir, 'home');
  mkdirSync(join(fakeHome, 'server'), { recursive: true });
  mkdirSync(join(project, '.atelier'), { recursive: true });
  // A "server" that exits at once: readiness never succeeds.
  writeFileSync(join(fakeHome, 'server/index.js'), 'process.exit(1);\n');
  const pidFile = join(project, '.atelier', 'server.pid');
  writeFileSync(pidFile, '424242\n');
  try {
    const r = spawnSync('bash', [START, project], { env: { ...process.env, HOME: dir, DRAWING_HOME: fakeHome, DRAW_PORT: '', DISPATCH_PORT: '' }, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /did not start/);
    assert.equal(readFileSync(pidFile, 'utf8'), '424242\n', 'old pid file untouched');
    assert.ok(!existsSync(join(project, '.atelier', 'server.port')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project mode serves the whole app: no redirect to /dispatch, same as drawing mode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30-redir-'));
  writeFileSync(join(dir, 'index.html'), '<p>spa</p>');
  writeFileSync(join(dir, 'app.v2.js'), 'x');
  try {
    for (const projectMode of [true, false]) {
      const app = await createApp({ workspaceDir: dir, projectMode }, { moduleList: [], publicDir: dir + '/' });
      await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${app.server.address().port}`;
      try {
        for (const method of ['GET', 'HEAD']) {
          for (const p of ['/', '/index.html', '/some/editor/route', '/notes.v2', '/dispatch']) {
            const r = await fetch(base + p, { method, redirect: 'manual' });
            assert.equal(r.status, 200, `${method} ${p} (projectMode ${projectMode})`);
          }
        }
        assert.equal((await fetch(base + '/app.v2.js', { redirect: 'manual' })).status, 200);
      } finally {
        await app.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project mode: documents are writable; only the workspace folder list stays closed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e30-block-'));
  const ok = { method: 'POST', handler: (_q, res) => res.end('{}') };
  const mods = [{ name: 't', setup: async () => ({ routes: [
    ...['PUT', 'POST', 'DELETE'].map((method) => ({ ...ok, method, path: '/api/file' })),
    ...['POST', 'DELETE'].map((method) => ({ ...ok, method, path: '/api/folder' })),
    ...['/api/move', '/api/trash/restore', '/api/history', '/api/workspace/pr-tracking', '/api/pipeline/start'].map((path) => ({ ...ok, path })),
    { ...ok, method: 'PATCH', path: '/api/file/plan' },
  ] }) }];
  try {
    for (const projectMode of [true, false]) {
      const app = await createApp({ workspaceDir: dir, projectMode }, { moduleList: mods });
      await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${app.server.address().port}`;
      const call = async (method, path, headers = { 'x-drawing': '1' }) => (await fetch(base + path, { method, headers })).status;
      try {
        for (const [m, p] of [['PUT', '/api/file'], ['POST', '/api/file'], ['DELETE', '/api/file'], ['POST', '/api/folder'], ['DELETE', '/api/folder'], ['POST', '/api/move'], ['POST', '/api/trash/restore'], ['POST', '/api/history'], ['POST', '/api/pipeline/start'], ['PATCH', '/api/file/plan']])
          assert.equal(await call(m, p), 200, `${m} ${p}`);
        // The header rule still applies.
        assert.equal(await call('POST', '/api/move', {}), 403);
        for (const [m, p] of [['POST', '/api/workspaces'], ['POST', '/api/workspaces/open'], ['DELETE', '/api/workspaces']]) {
          const r = await fetch(base + p, { method: m, headers: { 'x-drawing': '1' } });
          if (projectMode) assert.equal(r.status, 403, `${m} ${p}`);
          else assert.notEqual(r.status, 403, `${m} ${p}`);
        }
      } finally {
        await app.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start.sh moves an older <project>/pipelines to .atelier/ once, and refuses while a server still runs on it', async () => {
  const { dir, project } = scratchProject();
  const fakeHome = join(dir, 'home');
  mkdirSync(join(fakeHome, 'server'), { recursive: true });
  writeFileSync(join(fakeHome, 'server/index.js'), 'process.exit(1);\n');
  mkdirSync(join(project, 'pipelines', '.drawing'), { recursive: true });
  writeFileSync(join(project, 'pipelines', 'plan.dpx.json'), '{}');
  const env = { ...process.env, HOME: dir, DRAWING_HOME: fakeHome, DRAW_PORT: '', DISPATCH_PORT: '' };
  const live = spawn('sleep', ['30'], { stdio: 'ignore' });
  try {
    // A live server still holds the old folder: nothing moves.
    writeFileSync(join(project, 'pipelines', '.drawing', 'server.lock'), JSON.stringify({ pid: live.pid, port: 1 }));
    const refused = spawnSync('bash', [START, project], { env, encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /still runs on .*pipelines/);
    assert.ok(existsSync(join(project, 'pipelines', 'plan.dpx.json')));
    assert.ok(!existsSync(join(project, '.atelier', 'plan.dpx.json')));
    assert.ok(!existsSync(join(project, '.atelier-move.lock')), 'the move lock is released on refusal');
    live.kill('SIGKILL');
    await waitDead(live.pid);
    // Stale lock: the folder moves (the fake server then fails to start, which is fine here).
    const moved = spawnSync('bash', [START, project], { env, encoding: 'utf8' });
    assert.match(moved.stderr, /Moved .*pipelines to .*\.atelier/);
    assert.equal((moved.stderr.match(/Moved /g) || []).length, 1);
    assert.ok(existsSync(join(project, '.atelier', 'plan.dpx.json')));
    assert.ok(!existsSync(join(project, 'pipelines')));
  } finally {
    live.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start.sh moves <project>/atelier into .atelier/ with its structure, never overwriting, and waits for another mover', async () => {
  const { dir, project } = scratchProject();
  const fakeHome = join(dir, 'home');
  mkdirSync(join(fakeHome, 'server'), { recursive: true });
  writeFileSync(join(fakeHome, 'server/index.js'), 'process.exit(1);\n');
  mkdirSync(join(project, 'atelier', 'Server', '단일-폴더-저장'), { recursive: true });
  mkdirSync(join(project, 'atelier', '.drawing', 'history'), { recursive: true });
  writeFileSync(join(project, 'atelier', 'Server', '단일-폴더-저장', '계획.dpx.json'), '{"old":1}');
  writeFileSync(join(project, 'atelier', '.project.json'), '{"old":1}');
  writeFileSync(join(project, 'atelier', 'memo.dpx.json'), '{"old":1}');
  // .atelier/ already holds a memo with the same name (and state another step keeps there).
  mkdirSync(join(project, '.atelier'), { recursive: true });
  writeFileSync(join(project, '.atelier', 'memo.dpx.json'), '{"new":1}');
  const env = { ...process.env, HOME: dir, DRAWING_HOME: fakeHome, DRAW_PORT: '', DISPATCH_PORT: '' };
  const holder = spawn('sleep', ['30'], { stdio: 'ignore' });
  try {
    // Another start.sh holds the move lock: nothing moves.
    mkdirSync(join(project, '.atelier-move.lock'));
    writeFileSync(join(project, '.atelier-move.lock', 'pid'), String(holder.pid));
    const busy = spawnSync('bash', [START, project], { env, encoding: 'utf8' });
    assert.notEqual(busy.status, 0);
    assert.match(busy.stderr, /Another start\.sh is moving/);
    assert.ok(existsSync(join(project, 'atelier', 'Server', '단일-폴더-저장', '계획.dpx.json')));
    // The holder is gone: its stale lock is broken and the move runs.
    holder.kill('SIGKILL');
    await waitDead(holder.pid);
    const moved = spawnSync('bash', [START, project], { env, encoding: 'utf8' });
    assert.match(moved.stderr, /left in .*atelier because \.atelier\/ already has them: memo\.dpx\.json/);
    assert.equal(readFileSync(join(project, '.atelier', 'Server', '단일-폴더-저장', '계획.dpx.json'), 'utf8'), '{"old":1}');
    assert.ok(existsSync(join(project, '.atelier', '.drawing', 'history')));
    assert.equal(readFileSync(join(project, '.atelier', '.project.json'), 'utf8'), '{"old":1}');
    assert.equal(readFileSync(join(project, '.atelier', 'memo.dpx.json'), 'utf8'), '{"new":1}', 'never overwritten');
    assert.equal(readFileSync(join(project, 'atelier', 'memo.dpx.json'), 'utf8'), '{"old":1}', 'the clash stays in the old folder');
    assert.ok(!existsSync(join(project, '.atelier-move.lock')));
  } finally {
    holder.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stop.sh still recognizes a server started on the older <project>/pipelines', async () => {
  const { dir, project } = scratchProject();
  mkdirSync(join(dir, 'fake/server'), { recursive: true });
  writeFileSync(join(dir, 'fake/server/index.js'), 'setInterval(() => {}, 1000);\n');
  const old = spawn(process.execPath, [join(dir, 'fake/server/index.js'), '--project-mode', join(project, 'pipelines')], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(project, '.atelier', 'server.pid'), String(old.pid));
    const r = spawnSync('bash', [STOP, project], { encoding: 'utf8' });
    assert.match(r.stdout, /Dispatch stopped/);
    await waitDead(old.pid);
    assert.ok(!alive(old.pid));
  } finally {
    old.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('start.sh on a project with an older .dispatch and no saved session: the server moves it to .atelier and none comes back (#782)', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'drawing-782-')));
  const project = join(dir, 'proj');
  execFileSync('mkdir', ['-p', project, join(dir, 'home')]);
  const git = (...a) => execFileSync('git', ['-C', project, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(project, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  mkdirSync(join(project, '.dispatch'));
  writeFileSync(join(project, '.dispatch', 'state.json'), JSON.stringify({ seq: 5, sessions: {} }));
  const r = spawnSync('bash', [START, project], { env: { ...process.env, HOME: join(dir, 'home'), DRAW_PORT: '', DISPATCH_PORT: '' }, encoding: 'utf8' });
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(project, '.dispatch')), false, 'no .dispatch after start');
    assert.equal(JSON.parse(readFileSync(join(project, '.atelier', 'state.json'), 'utf8')).seq, 5);
    const pid = Number(readFileSync(join(project, '.atelier', 'server.pid'), 'utf8'));
    assert.doesNotThrow(() => process.kill(pid, 0));
    assert.match(readFileSync(join(project, '.atelier', 'server.log'), 'utf8'), /moved \.dispatch to \.atelier/);
  } finally {
    try { process.kill(Number(readFileSync(join(project, '.atelier', 'server.pid'), 'utf8')), 'SIGTERM'); } catch {}
    await new Promise((res) => setTimeout(res, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});
