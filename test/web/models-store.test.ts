// Shared model-connection subscription (#616, #625): one /api/dispatch fetch for many readers, live events, and it
// stops with the last reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelsStore, type ModelsDeps } from '../../web/src/settings/modelsStore.ts';

function fakeDeps(over: Partial<ModelsDeps> = {}) {
  const calls = { dispatch: 0, providers: 0, limits: 0, every: 0, stopped: 0, polls: 0, pollStops: 0 };
  const handlers: { providers?: (pv: Record<string, unknown>) => void; conn?: (up: boolean) => void; changed?: () => void } = {};
  const off = () => () => void calls.stopped++;
  const deps: ModelsDeps = {
    dispatch: async () => (calls.dispatch++, { enabled: true }),
    providers: async () => (calls.providers++, { claude: { connected: true } as never }),
    limits: async () => (calls.limits++, {}),
    onProviders: (fn) => ((handlers.providers = fn as never), off()),
    onLimits: () => off(),
    onConnection: (fn) => ((handlers.conn = fn), off()),
    onChanged: (fn) => ((handlers.changed = fn), off()),
    every: () => (calls.every++, off()),
    pollLogins: () => (calls.polls++, () => void calls.pollStops++),
    ...over,
  };
  return { deps, calls, handlers };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('two readers share one /api/dispatch fetch and one timer', async () => {
  const { deps, calls } = fakeDeps();
  const s = createModelsStore(deps);
  const a = s.subscribe(() => {});
  const b = s.subscribe(() => {});
  await tick();
  assert.equal(calls.dispatch, 1);
  assert.equal(calls.every, 1);
  assert.deepEqual(s.get().status, { enabled: true });
  assert.equal(s.get().providers.claude?.connected, true);
  a();
  assert.equal(calls.stopped, 0, 'still one reader');
  b();
  assert.equal(calls.stopped, 5, 'every listener removed with the last reader');
});

test('a reload while one runs shares it', async () => {
  const { deps, calls } = fakeDeps();
  const s = createModelsStore(deps);
  await Promise.all([s.reload(), s.reload()]);
  assert.equal(calls.dispatch, 1);
});

test('Dispatch off keeps the reason and fetches no providers; a failed request reads as off', async () => {
  const { deps, calls } = fakeDeps({ dispatch: async () => ({ enabled: false, reason: 'not-git' }) });
  const s = createModelsStore(deps);
  await s.reload();
  assert.deepEqual(s.get().status, { enabled: false, reason: 'not-git' });
  assert.equal(calls.providers, 0);
  const f = createModelsStore(fakeDeps({ dispatch: async () => Promise.reject(new Error('x')) }).deps);
  await f.reload();
  assert.deepEqual(f.get().status, { enabled: false });
});

test('providers event updates at once; reconnect reloads; a busy login polls until done', async () => {
  const { deps, calls, handlers } = fakeDeps();
  const s = createModelsStore(deps);
  let seen = 0;
  const off = s.subscribe(() => seen++);
  await tick();
  handlers.conn!(true);
  await tick();
  assert.equal(calls.dispatch, 1, 'first connection does not reload');
  handlers.providers!({ claude: { busy: true } });
  assert.equal(s.get().providers.claude?.busy, true);
  assert.equal(calls.polls, 1);
  handlers.providers!({ claude: { connected: true } });
  assert.equal(calls.pollStops, 1);
  handlers.conn!(false);
  handlers.conn!(true);
  await tick();
  assert.equal(calls.dispatch, 2);
  assert.ok(seen > 0);
  off();
});
