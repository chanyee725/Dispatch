import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { listServiceProjects } from '../../server/dispatch/service-projects.js';

async function fixtureHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'dispatch-services-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  });
  return home;
}

async function register(dir, port, { stateDir = '.dispatch', pid = process.pid, lockPort = Number(port) } = {}) {
  const state = join(dir, stateDir);
  await mkdir(join(state, '.drawing'), { recursive: true });
  await writeFile(join(state, 'server.port'), String(port));
  if (pid !== null) {
    await writeFile(join(state, 'server.pid'), String(pid));
    await writeFile(join(state, '.drawing', 'server.lock'), JSON.stringify({ pid, port: lockPort }));
  }
  return dir;
}

async function peerFixture(t, count) {
  const dir = await fixtureHome(t);
  const root = await register(join(dir, 'Dispatch'), 4100);
  const peers = await Promise.all(Array.from({ length: count }, async (_, i) => {
    const name = `peer-${i}`;
    const path = join(dir, name);
    const port = 4101 + i;
    await register(path, port);
    return { name, path, port, current: true };
  }));
  const query = { root, port: 4100, deployments: peers.map((peer) => peer.path), workspaces: [] };
  return { peers, query };
}

test('service projects use recorded ports and require a matching live Dispatch identity', async (t) => {
  const home = await fixtureHome(t);

  const add = (name, port, options) => register(join(home, name), port, options);
  const root = await add('Dispatch', 4003);
  const client = await add('sim-client', '4000\n');
  const studio = await add('sim-studio', 4001, { stateDir: '.atelier' });
  await add('sim-studio', 4010);
  await add('sim-client', 4011, { stateDir: '.atelier' });
  const keeper = await add('keeper2-bridge', 4002);
  const offline = await add('offline', 4010);
  const dead = await add('stopped', 4012, { pid: 2147483647 });
  const noPid = await add('unregistered', 4013, { pid: null });
  const mismatched = await add('mismatched', 4014, { lockPort: 4000 });
  const wrong = await add('old/sim-client', 4000);
  const sameName = await add('other/sim-client', 4016);
  const ambiguous = await add('ambiguous', 4015);
  const invalid = await add('invalid', '4004junk');
  const internal = await add('Dispatch/.dispatch/wt/transcripts', 4020);
  const alias = join(home, 'alias');
  await symlink(client, alias);

  const calls = [];
  const live = new Map([
    [4000, [['sim-client', client]]], [4001, [['sim-studio', '~/sim-studio']]],
    [4002, [['keeper2-bridge', keeper]]], [4011, [['sim-client', client]]],
    [4012, [['stopped', dead]]], [4013, [['unregistered', noPid]]],
    [4014, [['mismatched', mismatched]]], [4015, [['ambiguous', ambiguous], ['other', '/other']]],
    [4016, [['sim-client', sameName]]],
  ]);
  t.mock.method(globalThis, 'fetch', async (url, { redirect }) => {
    assert.equal(redirect, 'error');
    const target = new URL(url);
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.pathname, '/api/projects');
    const port = Number(target.port);
    calls.push(port);
    const service = live.get(port);
    if (!service) throw new Error('offline');
    return Response.json({ projects: service.map(([name, path]) => ({ name, path, port, current: true })) });
  });

  const query = {
    root,
    port: 4003,
    deployments: [client, studio, keeper, offline, dead, noPid, mismatched, wrong, sameName, ambiguous, invalid, internal, alias, '~/missing'],
    workspaces: [{ path: join(client, '.dispatch') }],
  };
  assert.deepEqual(await listServiceProjects(query), [
    { name: 'Dispatch', port: 4003, current: true },
    { name: 'keeper2-bridge', port: 4002, current: false },
    { name: 'sim-client', port: 4000, current: false },
    { name: 'sim-client', port: 4016, current: false },
    { name: 'sim-studio', port: 4001, current: false },
  ]);
  assert.deepEqual(calls.slice().sort(), [4000, 4001, 4002, 4010, 4015, 4016]);

  live.delete(4002);
  assert.deepEqual((await listServiceProjects(query)).map((p) => p.port), [4003, 4000, 4016, 4001]);
  await rm(join(root, '.dispatch', 'server.pid'));
  assert.deepEqual((await listServiceProjects(query)).map((p) => p.port), [4000, 4016, 4001]);
});

test('service lookup shares one deadline across batches and keeps completed peers', async (t) => {
  const { peers, query } = await peerFixture(t, 17);
  const slow = new Map();
  const called = [];
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    const port = Number(new URL(url).port);
    called.push(port);
    const peer = peers.find((entry) => entry.port === port);
    if (peer === peers[0] || peer === peers[8]) return Response.json({ projects: [peer] });
    slow.set(port, signal);
    if (peer === peers[9]) {
      const body = new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
      });
      return new Response(body);
    }
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });

  const results = await listServiceProjects(query);
  assert.deepEqual(results.map((entry) => entry.port), [4100, 4101, 4109]);
  assert.deepEqual(called.sort((a, b) => a - b), peers.slice(0, 16).map((peer) => peer.port));
  assert.ok([...slow.values()].every((signal) => signal.aborted));
  assert.equal(slow.get(4102).reason.name, 'TimeoutError');
  assert.equal(slow.get(4110).reason.message, 'Service lookup timed out');
});

test('service lookup limits response bytes before parsing and cancels excess reading', async (t) => {
  const { peers, query } = await peerFixture(t, 2);
  let oversizedPulls = 0;
  let oversizedCancelled = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const peer = peers.find((entry) => entry.port === Number(new URL(url).port));
    const json = Buffer.from('\uFEFF' + JSON.stringify({ projects: [peer], note: '한글' }));
    const atLimit = Buffer.concat([json, Buffer.alloc(64 * 1024 - json.length, ' ')]);
    const split = json.indexOf(Buffer.from('한')) + 1;
    const chunks = [atLimit.subarray(0, split), atLimit.subarray(split)];
    const oversized = peer === peers[1];
    if (oversized) chunks.push(Buffer.from(' '), Buffer.from(' '));
    return new Response(new ReadableStream({
      pull(controller) {
        if (oversized) oversizedPulls++;
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        if (oversized) oversizedCancelled = true;
      },
    }, { highWaterMark: 0 }));
  });

  assert.deepEqual((await listServiceProjects(query)).map((entry) => entry.port), [4100, 4101]);
  assert.equal(oversizedPulls, 3);
  assert.equal(oversizedCancelled, true);
});

test('concurrent service requests share matching work and only one scan runs per process', { timeout: 5_000 }, async (t) => {
  const { peers, query } = await peerFixture(t, 2);
  const [firstPeer, otherPeer] = peers;
  query.deployments = [firstPeer.path];
  const otherQuery = { ...query, deployments: [otherPeer.path] };
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const port = Number(new URL(url).port);
    calls.push(port);
    if (port === firstPeer.port) {
      started.resolve();
      await release.promise;
    }
    return Response.json({ projects: [peers.find((entry) => entry.port === port)] });
  });

  const first = listServiceProjects(query);
  await started.promise;
  const concurrent = listServiceProjects({ ...query, deployments: [...query.deployments] });
  let unrelated;
  try {
    unrelated = await listServiceProjects(otherQuery);
  } finally {
    release.resolve();
  }
  const [result, shared] = await Promise.all([first, concurrent]);
  assert.deepEqual(unrelated, [{ name: 'Dispatch', port: 4100, current: true }]);
  assert.deepEqual(shared, result);
  assert.deepEqual(result.map((entry) => entry.port), [4100, 4101]);
  assert.deepEqual(calls, [4101]);
  assert.deepEqual((await listServiceProjects(otherQuery)).map((entry) => entry.port), [4100, 4102]);
  assert.deepEqual(calls, [4101, 4102]);
});

test('a slow settings read counts toward the deadline and starts no scan after it', { timeout: 5_000 }, async (t) => {
  const { peers, query } = await peerFixture(t, 1);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(Number(new URL(url).port));
    return Response.json({ projects: peers });
  });
  const settingsRead = Promise.withResolvers();
  const workspaces = () => new Promise((resolve) => setTimeout(() => {
    resolve([{ path: peers[0].path }]);
    settingsRead.resolve();
  }, 2_200));

  const start = performance.now();
  const result = await listServiceProjects({ ...query, deployments: [], workspaces });
  const elapsed = performance.now() - start;
  assert.deepEqual(result, [{ name: 'Dispatch', port: 4100, current: true }]);
  assert.ok(elapsed < 1_700, `answered after ${Math.round(elapsed)}ms`);

  await settingsRead.promise;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(calls, []);
  // The slot stayed free, so the next request scans normally.
  assert.deepEqual((await listServiceProjects({ ...query, deployments: [], workspaces: [{ path: peers[0].path }] }))
    .map((entry) => entry.port), [4100, 4101]);
  assert.deepEqual(calls, [4101]);
});

test('a request joining after a slow settings read keeps its own deadline', { timeout: 5_000 }, async (t) => {
  const { peers, query } = await peerFixture(t, 1);
  const settings = Promise.withResolvers();
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const fetchPeer = t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    started.resolve();
    await release.promise;
    signal.throwIfAborted();
    return Response.json({ projects: peers });
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const first = listServiceProjects({ ...query, workspaces: () => settings.promise });
  t.mock.timers.tick(1_000);
  const second = listServiceProjects(query);
  await started.promise;
  settings.resolve([]);
  await setImmediate();

  t.mock.timers.tick(500);
  const resultAtDeadline = await Promise.race([first, setImmediate()]);
  release.resolve();
  const [, discovered] = await Promise.all([first, second]);

  assert.deepEqual(resultAtDeadline, [{ name: 'Dispatch', port: 4100, current: true }]);
  assert.deepEqual(discovered.map((entry) => entry.port), [4100, 4101]);
  assert.equal(fetchPeer.mock.callCount(), 1);
});
