// atelier-team relay.sh (#823): start the next team first, then remove the old lead's teammates and the lead last.
// A stub HTTP server stands in for Atelier and DISPATCH_TEAM_SH for team.sh; no real server or CLI runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stubServer, pluginTree, runScript } from './helpers/atelier-team.mjs';

const RELAY = new URL('../plugin/skills/atelier-team/scripts/relay.sh', import.meta.url).pathname;

const SESSIONS = [
  { id: 'lead-a', name: 'Dino', canSpawn: true, parent: null },
  { id: 'impl-a', name: 'Iris', canSpawn: false, parent: 'lead-a' },
  { id: 'rev-a', name: 'Gus', canSpawn: false, parent: 'lead-a' },
  { id: 'lead-b', name: 'Ruby', canSpawn: true, parent: null },
  { id: 'impl-b', name: 'Vic', canSpawn: false, parent: 'lead-b' },
];

async function withStub(fn) {
  const removed = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/state') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ sessions: SESSIONS }));
    }
    const m = req.method === 'POST' && req.url.match(/^\/api\/sessions\/([^/]+)\/remove$/);
    if (m && req.headers['x-dispatch'] === '1') {
      removed.push(m[1]);
      return res.end('{"ok":true}');
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'atelier-relay-'));
  try {
    return await fn({ port: server.address().port, dir, removed });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function fakeTeam(dir, exitCode) {
  const p = join(dir, 'team.sh');
  writeFileSync(p, `#!/bin/sh\nprintf '%s|%s|%s|%s' "$DISPATCH_PORT" "$1" "$2" "$3" > "${dir}/team-args"\necho "New\\tclaude-sonnet-5-5\\tdispatch/lead-9"\nexit ${exitCode}\n`);
  chmodSync(p, 0o755);
  return p;
}

function run(args, env) {
  return new Promise((resolve) => {
    const c = spawn('bash', [RELAY, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => (stdout += d));
    c.stderr.on('data', (d) => (stderr += d));
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('relay.sh starts the new team, then removes only that lead\'s teammates and the lead last', () =>
  withStub(async ({ port, dir, removed }) => {
    const r = await run([dir, 'Dino', 'small', 'Issues #705, #715'], { DISPATCH_PORT: String(port), DISPATCH_TEAM_SH: fakeTeam(dir, 0) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /dispatch\/lead-9/);
    assert.equal(readFileSync(join(dir, 'team-args'), 'utf8'), `${port}|${dir}|small|Issues #705, #715`);
    assert.deepEqual(removed, ['impl-a', 'rev-a', 'lead-a']);
  }));

test('relay.sh keeps the old team when the new team does not start', () =>
  withStub(async ({ port, dir, removed }) => {
    const r = await run([dir, 'Dino', 'small', 'Issue #705'], { DISPATCH_PORT: String(port), DISPATCH_TEAM_SH: fakeTeam(dir, 1) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /old team is kept/);
    assert.deepEqual(removed, []);
  }));

test('relay.sh with an empty task only removes the old team; port comes from .atelier/server.port', () =>
  withStub(async ({ port, dir, removed }) => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, '.atelier'));
    writeFileSync(join(dir, '.atelier', 'server.port'), `${port}\n`);
    const r = await run([dir, 'Ruby', 'small', ''], { DISPATCH_PORT: '', DISPATCH_TEAM_SH: fakeTeam(dir, 0) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(dir, 'team-args')), false, 'no new team for an empty task');
    assert.deepEqual(removed, ['impl-b', 'lead-b']);
  }));

test('relay.sh refuses an unknown lead without starting or removing anything', () =>
  withStub(async ({ port, dir, removed }) => {
    const r = await run([dir, 'Nobody', 'small', 'Issue #1'], { DISPATCH_PORT: String(port), DISPATCH_TEAM_SH: fakeTeam(dir, 0) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /No lead named "Nobody"\. Leads: Dino, Ruby/);
    assert.equal(existsSync(join(dir, 'team-args')), false);
    assert.deepEqual(removed, []);
  }));

// #1031: the real team.sh behind relay.sh against a stub that keeps the sessions it makes.
const oldTeam = () => [
  { id: 'lead-a', name: 'Dino', role: 'lead', canSpawn: true, parent: null, status: 'idle', issue: 1000, task: '#1000 끝 · 다음 #1031' },
  { id: 'impl-a', name: 'Iris', role: 'impl', canSpawn: false, parent: 'lead-a', status: 'idle' },
];

test('relay.sh run twice for one issue leaves one lead: the second run prints it and creates nothing', async () => {
  const stub = await stubServer({ sessions: oldTeam() });
  const tree = pluginTree();
  try {
    const relay = join(tree.scripts, 'relay.sh');
    const env = { DISPATCH_PORT: String(stub.port) };
    const a = await runScript(relay, [tree.dir, 'Dino', 'small', 'Issue #1031'], env);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(stub.posts.length, 2, 'lead, then its team; the old lead naming #1031 in its task line is left out of the check');
    assert.deepEqual(stub.sessions.filter((s) => s.canSpawn).map((s) => s.name), ['S1']);
    // After a server restart the same relay runs again; the old lead is already gone.
    const b = await runScript(relay, [tree.dir, 'Dino', 'small', 'Issue #1031'], env);
    assert.equal(b.status, 0, b.stderr);
    assert.equal(b.stdout.trim(), 'S1');
    assert.match(b.stderr, /Issue #1031 already has a live lead \(S1\)/);
    assert.equal(stub.posts.length, 2, 'no second team');
    assert.equal(stub.sessions.filter((s) => s.role === 'lead').length, 1);
  } finally {
    stub.close();
    tree.cleanup();
  }
});

test('relay.sh: the new team makes its own merge role; the old lead\'s merge role is removed, not reused', async () => {
  const sessions = [...oldTeam(), { id: 'merge-a', name: 'Mia', role: 'merge', canSpawn: false, parent: 'lead-a', status: 'idle' }];
  const stub = await stubServer({ sessions });
  const tree = pluginTree();
  try {
    const r = await runScript(join(tree.scripts, 'relay.sh'), [tree.dir, 'Dino', 'small', 'Issue #1031'], { DISPATCH_PORT: String(stub.port) });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(stub.posts[1].items.some((i) => i.role === 'merge'), 'the new team has a merge role');
    assert.doesNotMatch(stub.posts[0].commonPrompt, /The merge role of this project is/);
    assert.doesNotMatch(stub.posts[0].commonPrompt, /Mia/);
    const merge = stub.sessions.filter((s) => s.role === 'merge');
    assert.equal(merge.length, 1, 'only the new merge role is left');
    assert.equal(merge[0].parent, 'id-1', 'it is the new lead\'s child');
    assert.deepEqual(stub.sessions.map((s) => s.id).filter((id) => /-a$/.test(id)), [], 'the old team is gone');
  } finally {
    stub.close();
    tree.cleanup();
  }
});

test('relay.sh with the issue already held still removes the old team it replaces, and starts nothing', async () => {
  const sessions = [...oldTeam(), { id: 'lead-n', name: 'Nova', role: 'lead', canSpawn: true, parent: null, status: 'running', issue: 1031 }];
  const stub = await stubServer({ sessions });
  const tree = pluginTree();
  try {
    const r = await runScript(join(tree.scripts, 'relay.sh'), [tree.dir, 'Dino', 'small', 'Issues #1031, #1032'], { DISPATCH_PORT: String(stub.port) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'Nova');
    assert.equal(stub.posts.length, 0);
    assert.deepEqual(stub.sessions.map((s) => s.name), ['Nova']);
  } finally {
    stub.close();
    tree.cleanup();
  }
});

test('relay.sh with the issue held by a board task of a live lead starts nothing; an unknown old lead is then no error', async () => {
  const stub = await stubServer({
    sessions: [{ id: 'lead-n', name: 'Nova', role: 'lead', canSpawn: true, parent: null, status: 'waiting', issue: null }],
    tasks: [{ id: 't', lead: 'lead-n', title: 'E716 #1031 역할', stage: 'review' }],
  });
  const tree = pluginTree();
  try {
    const r = await runScript(join(tree.scripts, 'relay.sh'), [tree.dir, 'Gone', 'small', 'Issue #1031'], { DISPATCH_PORT: String(stub.port) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'Nova');
    assert.equal(stub.posts.length, 0);
  } finally {
    stub.close();
    tree.cleanup();
  }
});

test('relay.sh keeps the old merge role while another live lead may use it (#1034)', async () => {
  const sessions = [...oldTeam(), { id: 'merge-a', name: 'Mia', role: 'merge', canSpawn: false, parent: 'lead-a', status: 'idle' },
    { id: 'lead-x', name: 'Xan', role: 'lead', canSpawn: true, parent: null, status: 'running', issue: 7 }];
  const stub = await stubServer({ sessions });
  const tree = pluginTree();
  try {
    const r = await runScript(join(tree.scripts, 'relay.sh'), [tree.dir, 'Dino', 'small', 'Issue #1031'], { DISPATCH_PORT: String(stub.port) });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(stub.sessions.some((s) => s.id === 'merge-a'), 'Mia stays for the other team');
    assert.ok(!stub.sessions.some((s) => s.id === 'lead-a'), 'the old lead is gone');
  } finally {
    stub.close();
    tree.cleanup();
  }
});

test('relay.sh prints the queue it did not hand over when another team holds its first issue (#1034)', async () => {
  const sessions = [...oldTeam(), { id: 'lead-n', name: 'Nova', role: 'lead', canSpawn: true, parent: null, status: 'running', issue: 1031 }];
  const stub = await stubServer({ sessions });
  const tree = pluginTree();
  try {
    const r = await runScript(join(tree.scripts, 'relay.sh'), [tree.dir, 'Dino', 'small', 'Issues #1031, #1032'], { DISPATCH_PORT: String(stub.port) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Queue not handed over; start it again without #1031: Issues #1031, #1032/);
  } finally {
    stub.close();
    tree.cleanup();
  }
});
