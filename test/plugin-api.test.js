// plugin/scripts/api.sh: the skills' one way to call the Atelier server (port lookup, x-drawing headers, errors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = fileURLToPath(new URL('../plugin/scripts/api.sh', import.meta.url));
// Not inside a git project, so no .atelier/server.port is picked up from the checkout running the tests.
const CWD = mkdtempSync(join(tmpdir(), 'api-sh-cwd-'));

function run(args, env = {}, input) {
  return new Promise((resolve) => {
    const child = execFile('bash', [API, ...args], { cwd: CWD, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
    if (input !== undefined) child.stdin.end(input);
  });
}

async function withServer(fn) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url.startsWith('/api/hang')) return; // never answers
      const status = req.url.startsWith('/api/missing') ? 404 : 200;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { ok: true } : { error: 'not found' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(server.address().port, seen);
  } finally {
    server.close();
  }
}

test('api.sh: GET has no write headers; POST sends x-drawing, the session id and the body', async () => {
  await withServer(async (port, seen) => {
    const env = { DRAW_PORT: String(port) };
    const get = await run(['GET', '/api/tree'], env);
    assert.equal(get.code, 0);
    assert.deepEqual(JSON.parse(get.stdout), { ok: true });
    assert.equal(seen[0].headers['x-drawing'], undefined);

    const post = await run(['post', '/api/file', '{"path":"a"}'], { ...env, DRAWING_SESSION: 's1' });
    assert.equal(post.code, 0);
    assert.equal(seen[1].method, 'POST');
    assert.equal(seen[1].headers['x-drawing'], '1');
    assert.equal(seen[1].headers['x-drawing-session'], 's1');
    assert.equal(seen[1].body, '{"path":"a"}');

    const stdin = await run(['PUT', '/api/file?path=a', '-'], env, '{"revision":1}');
    assert.equal(stdin.code, 0);
    assert.equal(seen[2].body, '{"revision":1}');
  });
});

test('api.sh: the port comes from <project>/.atelier/server.port; 4xx exits 1 with the body on stderr', async () => {
  const project = mkdtempSync(join(tmpdir(), 'api-sh-'));
  try {
    await withServer(async (port) => {
      mkdirSync(join(project, '.atelier'));
      writeFileSync(join(project, '.atelier/server.port'), `${port}\n`);
      const ok = await run(['-C', project, 'GET', '/api/info'], { DRAW_PORT: '1' });
      assert.equal(ok.code, 0);
      const miss = await run(['-C', project, 'DELETE', '/api/missing']);
      assert.equal(miss.code, 1);
      assert.match(miss.stderr, /^HTTP 404 \{"error":"not found"\}/);
    });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('api.sh: refuses other methods and paths outside /api/', async () => {
  assert.equal((await run(['HEAD', '/api/tree'])).code, 2);
  assert.equal((await run(['GET', 'http://example.com/api/tree'])).code, 2);
});

test('api.sh: brackets in a query go out as they are (-g), and a hung server times out (#1034)', async () => {
  await withServer(async (port, seen) => {
    const env = { DRAW_PORT: String(port) };
    const r = await run(['GET', '/api/file?path=a[1]{x}'], env);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(seen.at(-1).url, '/api/file?path=a[1]{x}');
    const t0 = Date.now();
    const hung = await run(['GET', '/api/hang'], { ...env, ATELIER_API_TIMEOUT: '1' });
    assert.equal(hung.code, 1);
    assert.ok(Date.now() - t0 < 5000);
    assert.equal((await run(['GET', '/api/tree'], { ...env, ATELIER_API_TIMEOUT: 'x' })).code, 2);
  });
});
