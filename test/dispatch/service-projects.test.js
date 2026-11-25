import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { listServiceProjects } from '../../server/dispatch/service-projects.js';

test('service projects use recorded ports and require a matching live Dispatch identity', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dispatch-services-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  async function register(name, port, stateDir = '.dispatch') {
    const dir = join(home, name);
    const state = join(dir, stateDir);
    await mkdir(state, { recursive: true });
    await writeFile(join(state, 'server.port'), port);
    return dir;
  }

  const root = await register('Dispatch', '4003');
  const client = await register('sim-client', '4000\n');
  const studio = await register('sim-studio', '4001', '.atelier');
  await register('sim-studio', '4010');
  const keeper = await register('keeper2-bridge', '4002');
  const stale = await register('stopped', '4010');
  const wrong = await register('old/sim-client', '4000');
  const invalid = await register('invalid', '4004junk');
  const internal = await register('Dispatch/.dispatch/wt/transcripts', '4020');
  const alias = join(home, 'alias');
  await symlink(client, alias);

  const calls = [];
  const live = new Map([[4000, ['sim-client', client]], [4001, ['sim-studio', '~/sim-studio']], [4002, ['keeper2-bridge', keeper]]]);
  t.mock.method(globalThis, 'fetch', async (url, { redirect }) => {
    assert.equal(redirect, 'error');
    const target = new URL(url);
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.pathname, '/api/projects');
    const port = Number(target.port);
    calls.push(port);
    const service = live.get(port);
    if (!service) throw new Error('offline');
    const [name, path] = service;
    return Response.json({ projects: [{ name, path, port, current: true }] });
  });

  const query = {
    root,
    port: 4003,
    deployments: [client, studio, keeper, stale, wrong, invalid, internal, alias, '~/missing'],
    workspaces: [{ path: join(client, '.dispatch') }],
  };
  assert.deepEqual(await listServiceProjects(query), [
    { name: 'sim-client', port: 4000, current: false },
    { name: 'sim-studio', port: 4001, current: false },
    { name: 'keeper2-bridge', port: 4002, current: false },
    { name: 'Dispatch', port: 4003, current: true },
  ]);
  assert.deepEqual(calls.slice().sort(), [4000, 4001, 4002, 4010]);

  live.delete(4002);
  assert.deepEqual((await listServiceProjects(query)).map((p) => p.port), [4000, 4001, 4003]);
});
