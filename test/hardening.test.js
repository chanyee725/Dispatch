import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { parseArgs } from '../server/cli.js';

const INDEX = fileURLToPath(new URL('../server/index.js', import.meta.url));

function get(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: host ? { host } : {} }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function startApp(moduleList = []) {
  const pub = await mkdtemp(join(tmpdir(), 'draw-pub-'));
  await writeFile(join(pub, 'index.html'), '<!doctype html><div id="root"></div>');
  const app = await createApp({ workspaceDir: pub }, { publicDir: pub, moduleList });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  return { app, pub, port, async stop() { await app.close(); await rm(pub, { recursive: true, force: true }); } };
}

test('host header: loopback names on our port pass, anything else is 403', async () => {
  const s = await startApp();
  try {
    assert.equal((await get(s.port, '/', `127.0.0.1:${s.port}`)).status, 200);
    assert.equal((await get(s.port, '/', `localhost:${s.port}`)).status, 200);
    assert.equal((await get(s.port, '/', 'evil.example:80')).status, 403);
    assert.equal((await get(s.port, '/api/events', `evil.example:${s.port}`)).status, 403);
    assert.equal((await get(s.port, '/', '127.0.0.1:1')).status, 403);
  } finally {
    await s.stop();
  }
});

test('static: unreadable file gives an error status and the server keeps serving', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root can read mode-000 files');
  const s = await startApp();
  try {
    const f = join(s.pub, 'secret.js');
    await writeFile(f, 'x');
    await chmod(f, 0o000);
    const host = `127.0.0.1:${s.port}`;
    assert.equal((await get(s.port, '/secret.js', host)).status, 404);
    assert.equal((await get(s.port, '/', host)).status, 200);
  } finally {
    await s.stop();
  }
});

test('static: responses carry a same-origin CSP (no CDN, no outside connects)', async () => {
  const s = await startApp();
  try {
    const r = await get(s.port, '/', `127.0.0.1:${s.port}`);
    const csp = r.headers['content-security-policy'];
    assert.ok(csp, 'CSP header present');
    const dir = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    assert.deepEqual(dir['default-src'], ["'self'"]);
    assert.deepEqual(dir['script-src'], ["'self'"]);
    assert.deepEqual(dir['connect-src'], ["'self'"]);
    assert.deepEqual(dir['img-src'], ["'self'", 'data:', 'blob:']);
    assert.deepEqual(dir['font-src'], ["'self'", 'data:']);
    assert.doesNotMatch(csp, /https?:|\*/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  } finally {
    await s.stop();
  }
});

test('modules are closed in reverse setup order', async () => {
  const order = [];
  const mod = (name) => ({ name, setup: async () => ({ close: () => order.push(name) }) });
  const s = await startApp([mod('a'), mod('b'), mod('c')]);
  await s.stop();
  assert.deepEqual(order, ['c', 'b', 'a']);
});

test('cli: one workspace dir, unknown flags and extra args are rejected', () => {
  assert.deepEqual(parseArgs(['/p'], {}), { workspaceDir: '/p', projectMode: false });
  assert.throws(() => parseArgs(['/p', '--port', '1']), /Unknown option: --port/);
  assert.throws(() => parseArgs(['/p', '/q']), /Unexpected argument/);
  assert.throws(() => parseArgs([]), /Missing <workspace-dir>/);
});

test('cli: port in use prints a hint and exits 1', async () => {
  const blocker = createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const port = blocker.address().port;
  const dir = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  try {
    const child = spawn(process.execPath, [INDEX, dir], { env: { ...process.env, DRAW_PORT: String(port) } });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c));
    const code = await new Promise((r) => child.on('exit', r));
    assert.equal(code, 1);
    assert.match(stderr, new RegExp(`Port ${port} is already in use`));
  } finally {
    blocker.close();
    await rm(dir, { recursive: true, force: true });
  }
});
