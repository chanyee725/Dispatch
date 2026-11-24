import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFETCH_DELAY_MS, REFETCH_MAX_WAIT_MS, REFETCH_TIMEOUT_MESSAGE, REFETCH_TIMEOUT_MS, aggregate, alwaysOnOrder, burnNow, cacheRate, createUsageRefetcher, outliers, projectUsageFail, projectUsageOk,
  projectUsageShown, rowHistory,
  topSessions, totals, usageKey, weekHint,
} from '../../web/src/dispatch/lib/usage.ts';
import type { SessionState, UsageDay } from '../../shared/dispatch/types.ts';

const u = (input: number, output: number, cacheRead: number, cacheWrite: number, cost: number) => ({ input, output, cacheRead, cacheWrite, cost });
const day = (d: string, cost: number, extra: Partial<UsageDay> = {}): UsageDay => ({ day: d, cost, models: {}, roles: {}, ...extra });

test('aggregate sums tokens and cost per model and cost per role', () => {
  const days = [
    day('2026-11-13', 3, { models: { m1: u(10, 5, 100, 1, 2), m2: u(1, 1, 0, 0, 1) }, roles: { impl: 2, lead: 1 } }),
    day('2026-11-14', 4, { models: { m1: u(20, 5, 50, 2, 4) }, roles: { impl: 4 } }),
  ];
  const { byModel, byRole } = aggregate(days);
  assert.deepEqual(byModel.m1, u(30, 10, 150, 3, 6));
  assert.deepEqual(byModel.m2, u(1, 1, 0, 0, 1));
  assert.deepEqual(byRole, { impl: 6, lead: 1 });
  assert.equal(cacheRate(byModel), 150 / (31 + 150 + 3));
  assert.equal(cacheRate({}), null);
});

test('totals split the 14 days into today, last 7 and the 7 before', () => {
  const days = Array.from({ length: 14 }, (_, i) => day(`d${i}`, i < 7 ? 1 : 2));
  assert.deepEqual(totals(days), { today: 2, week: 14, prev: 7, all: 21 });
  assert.deepEqual(totals([]), { today: 0, week: 0, prev: 0, all: 0 });
  const usd = (n: number) => `$${n}`;
  assert.equal(weekHint(14, 7, usd), '그 전 7일보다 +100%');
  assert.equal(weekHint(7, 14, usd), '그 전 7일보다 -50%');
  assert.equal(weekHint(14, 0, usd), '하루 평균 $2');
});

test('outliers flag days at twice the median of spending days, needing three of them', () => {
  assert.deepEqual(outliers([0, 1, 1, 0, 5]), { median: 1, ratio: [null, null, null, null, 5] });
  assert.deepEqual(outliers([0, 0, 1, 9]).ratio, [null, null, null, null]);
  assert.equal(outliers([1, 2, 3, 4]).median, 2.5);
});

test('burn rate and top sessions skip sessions without numbers', () => {
  const ss = [
    { id: 'a', cost: 1, burn: { perHour: 2, windowMin: 30 } },
    { id: 'b', cost: null, burn: null },
    { id: 'c', cost: 5, burn: { perHour: null, windowMin: 30 } },
    { id: 'd', cost: 3, burn: { perHour: 0.5, windowMin: 30 } },
  ];
  assert.deepEqual(burnNow(ss), { perHour: 2.5, rated: 2 });
  assert.deepEqual(topSessions(ss).map(s => s.id), ['c', 'd', 'a']);
  assert.deepEqual(topSessions(ss, 1).map(s => s.id), ['c']);
});

test('always-on order: needs-a-person first, then start time and id, stable across ticks', () => {
  type S = { id: string; startedAt: number; st: SessionState };
  const list: S[] = [
    { id: 'w2', startedAt: 2, st: 'working' }, { id: 'd', startedAt: 0, st: 'done' }, { id: 'w1', startedAt: 1, st: 'working' },
    { id: 'q', startedAt: 9, st: 'waiting' }, { id: 'f', startedAt: 9, st: 'failed' }, { id: 's', startedAt: 9, st: 'stuck' },
  ];
  assert.deepEqual(alwaysOnOrder(list, s => s.st).map(s => s.id), ['f', 's', 'q', 'w1', 'w2', 'd']);
  assert.deepEqual(list[0].id, 'w2', 'input left alone');
});

test('a timeline row adds the live state after the server history', () => {
  const server: [number, string][] = [[100, 'working']];
  assert.deepEqual(rowHistory({ status: 'waiting', state: 'waiting', stateSince: 200 }, server, 300), [[100, 'working'], [200, 'waiting']]);
  assert.deepEqual(server, [[100, 'working']], 'server entries not mutated');
  assert.deepEqual(rowHistory({ status: 'running', state: 'working', stateSince: 150 }, server, 300), [[100, 'working']]);
  assert.deepEqual(rowHistory({ status: 'idle' }, undefined, 300), [[300, 'resting']]);
});

// Drives the page's own refetcher (createUsageRefetcher) on a fake clock. `answer(now)` decides each request:
// `after` = ms until it settles (Infinity: never), with `fail` saying whether it fails. Records the times requests
// went out, their abort signals, and what the page callbacks saw; `on` can swap a page callback (e.g. one that throws).
type Answer = { after: number; fail?: boolean };
type Callbacks = { result: (v: number) => void; error: (m: string) => void; loading: (on: boolean) => void };
function harness(answer: (now: number) => Answer = () => ({ after: 0 }), on: Partial<Callbacks> = {}) {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const sent: number[] = [];
  const signals: AbortSignal[] = [];
  const applied: { at: number; ok: boolean; message?: string }[] = [];
  const loading: boolean[] = [];
  const r = createUsageRefetcher(
    signal => {
      sent.push(now);
      signals.push(signal);
      const { after, fail } = answer(now);
      return new Promise<number>((ok, ko) => {
        if (after === Infinity) return;
        const id = nextId++;
        timers.set(id, { at: now + after, fn: () => (fail ? ko(new Error('HTTP 500')) : ok(now)) });
      });
    },
    {
      result: on.result ?? (() => applied.push({ at: now, ok: true })),
      error: on.error ?? (message => applied.push({ at: now, ok: false, message })),
      loading: on.loading ?? (v => loading.push(v)),
    },
    {
      now: () => now,
      setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
      clearTimeout: id => { timers.delete(id as number); },
    },
  );
  // Runs every timer due up to `until`, one ms at a time, letting promise callbacks settle in between.
  const run = async (until: number, changes: number[] = []) => {
    const queue = [...changes];
    for (; now <= until; now++) {
      for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); await flush(); }
      while (queue[0] === now) { queue.shift(); r.change(); }
    }
    now = until;
  };
  return { r, sent, signals, applied, loading, run };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('the refetcher waits for a burst to end but never longer than the max wait', async () => {
  const loaded = async () => { const h = harness(); h.r.change(); await h.run(0); assert.deepEqual(h.sent, [0]); return h; };
  // One change: one request REFETCH_DELAY_MS later.
  let h = await loaded();
  await h.run(20_000, [100]);
  assert.deepEqual(h.sent.slice(1), [100 + REFETCH_DELAY_MS]);
  // A burst inside the delay: one request after the last change.
  h = await loaded();
  await h.run(20_000, [100, 600, 1100]);
  assert.deepEqual(h.sent.slice(1), [1100 + REFETCH_DELAY_MS]);
  // Changes every second, forever: still a request within REFETCH_MAX_WAIT_MS of the first unanswered change.
  h = await loaded();
  await h.run(40_000, Array.from({ length: 30 }, (_, i) => 1000 + i * 1000));
  const sent = h.sent.slice(1);
  assert.ok(sent.length >= 2, `requests: ${sent}`);
  assert.ok(sent[0] - 1000 <= REFETCH_MAX_WAIT_MS, `first request ${sent[0]}`);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i] - sent[i - 1] <= REFETCH_MAX_WAIT_MS + 1000, `gap before ${sent[i]}`);
});

test('the refetcher tries every REFETCH_DELAY_MS while the first load keeps failing', async () => {
  // The first load goes at once and fails; then session events every 100 ms cost one try per REFETCH_DELAY_MS.
  const h = harness(() => ({ after: 50, fail: true }));
  h.r.change();
  await h.run(7000, Array.from({ length: 69 }, (_, i) => 100 + i * 100));
  assert.equal(h.sent[0], 0);
  assert.ok(h.sent.length >= 3 && h.sent.length <= 1 + 7000 / REFETCH_DELAY_MS, `requests: ${h.sent}`);
  for (let i = 1; i < h.sent.length; i++) assert.ok(h.sent[i] - h.sent[i - 1] >= REFETCH_DELAY_MS, `gap before ${h.sent[i]}: ${h.sent}`);
  assert.equal(h.r.clock.loaded, false);
  // The reload button goes at once.
  const before = h.sent.length;
  assert.equal(h.r.reload(), true);
  await h.run(7001);
  assert.equal(h.sent.length, before + 1);
  assert.equal(h.sent.at(-1), 7000);
});

test('a change while a request is out does not drop its answer (#334)', async () => {
  // The first load fails; the retry is slow (1.5 s) and session events keep coming while it is out.
  const h = harness(now => (now === 0 ? { after: 10, fail: true } : { after: 1500 }));
  h.r.change();
  await h.run(1000, [100]);
  assert.deepEqual(h.sent, [0, REFETCH_DELAY_MS].filter(t => t <= 1000));
  await h.run(3000, [2100, 2200, 2300, 2400]);
  assert.deepEqual(h.sent, [0, REFETCH_DELAY_MS], 'no second request while one is out');
  // The slow request's success is applied and clears loading, though events came in while it was out.
  await h.run(3600);
  assert.deepEqual(h.applied.map(a => a.ok), [false, true]);
  assert.equal(h.applied[1].at, REFETCH_DELAY_MS + 1500);
  assert.equal(h.loading.at(-1), false);
  assert.equal(h.r.clock.loaded, true);
  // The reload button does nothing while a request is out.
  const slow = harness(() => ({ after: 1000 }));
  slow.r.change();
  await slow.run(10);
  assert.equal(slow.r.reload(), false);
  await slow.run(1100);
  assert.deepEqual(slow.sent, [0]);
  assert.equal(slow.loading.at(-1), false);
});

test('after a load, a change while a request is out is picked up once it settles', async () => {
  const h = harness(now => ({ after: now === 0 ? 0 : 800 }));
  h.r.change();
  await h.run(0);
  await h.run(10_000, [100, 2500]); // request at 2100 is out until 2900; the change at 2500 waits for it
  assert.deepEqual(h.sent, [0, 100 + REFETCH_DELAY_MS, 2900 + REFETCH_DELAY_MS]);
  assert.equal(h.applied.length, 3);
  // After stop (unmount) no timer fires and answers are not applied.
  h.r.change();
  h.r.stop();
  await h.run(20_000);
  assert.equal(h.sent.length, 3);
});

test('a request that never answers times out, so later refetches and the reload button are not blocked', async () => {
  // The first load hangs forever: after REFETCH_TIMEOUT_MS it is aborted and shown as a failure.
  const h = harness(now => (now === 0 ? { after: Infinity } : { after: 10 }));
  h.r.change();
  await h.run(REFETCH_TIMEOUT_MS - 1);
  assert.deepEqual(h.applied, []);
  assert.equal(h.r.reload(), false, 'the reload button waits while the request is out');
  assert.equal(h.signals[0].aborted, false);
  await h.run(REFETCH_TIMEOUT_MS);
  assert.equal(h.signals[0].aborted, true, 'the hung request is aborted');
  assert.equal((h.signals[0].reason as Error).name, 'TimeoutError');
  assert.deepEqual(h.applied, [{ at: REFETCH_TIMEOUT_MS, ok: false, message: REFETCH_TIMEOUT_MESSAGE }]);
  assert.equal(h.loading.at(-1), false);
  // The reload button works again and its answer is applied.
  assert.equal(h.r.reload(), true);
  await h.run(REFETCH_TIMEOUT_MS + 20);
  assert.deepEqual(h.sent, [0, REFETCH_TIMEOUT_MS]);
  assert.deepEqual(h.applied.map(a => a.ok), [false, true]);
  assert.equal(h.r.clock.loaded, true);

  // A request that ignores its signal and answers after the deadline: only the timeout is applied, not the late answer.
  const late = harness(now => ({ after: now === 0 ? REFETCH_TIMEOUT_MS + 5000 : 10 }));
  late.r.change();
  await late.run(REFETCH_TIMEOUT_MS + 6000);
  assert.deepEqual(late.applied.map(a => a.message), [REFETCH_TIMEOUT_MESSAGE]);
  assert.equal(late.r.clock.loaded, false, 'the late answer does not count as a load');
  // After a load, a change that came in while the hung request was out is picked up once it times out.
  const after = harness(now => (now === 0 ? { after: 0 } : now === 100 + REFETCH_DELAY_MS ? { after: Infinity } : { after: 10 }));
  after.r.change();
  await after.run(40_000, [100, 3000]);
  // The change at 3000 is past its max wait by then, so the next request goes at once (the fake clock's next ms).
  assert.deepEqual(after.sent.slice(0, 2), [0, 2100]);
  assert.ok(after.sent[2] - (2100 + REFETCH_TIMEOUT_MS) <= 1, `requests: ${after.sent}`);
  assert.deepEqual(after.applied.map(a => a.ok), [true, false, true]);
});

test('stop() while a request is out drops its answer and keeps the refetcher usable after start()', async () => {
  const h = harness(() => ({ after: 1000 }));
  h.r.change();
  await h.run(10);
  assert.deepEqual(h.loading, [true]);
  h.r.stop();
  await h.run(2000);
  assert.deepEqual(h.applied, [], 'an answer after unmount is not applied');
  assert.deepEqual(h.loading, [true], 'loading is not touched after unmount');
  // Mounted again (e.g. a strict-mode remount): the next change sends a request and its answer is applied.
  h.r.start();
  h.r.change();
  await h.run(5100);
  assert.deepEqual(h.sent, [0, 2000 + REFETCH_DELAY_MS]);
  assert.deepEqual(h.applied.map(a => a.at), [3000 + REFETCH_DELAY_MS]);
  // A failure after unmount is dropped too.
  const failing = harness(() => ({ after: 500, fail: true }));
  failing.r.change();
  await failing.run(10);
  failing.r.stop();
  await failing.run(1000);
  assert.deepEqual(failing.applied, []);
  // A hung request still times out after unmount, so a remount is not stuck behind it.
  const hung = harness(now => (now === 0 ? { after: Infinity } : { after: 10 }));
  hung.r.change();
  await hung.run(10);
  hung.r.stop();
  await hung.run(REFETCH_TIMEOUT_MS + 1);
  assert.deepEqual(hung.applied, []);
  hung.r.start();
  assert.equal(hung.r.reload(), true);
});

test('a change while a slow request is out is capped from the change, not from the answer', async () => {
  // Loaded at 0; a change at 100 sends at 2100, which takes 9 s; a change at 2500 comes in while it is out.
  const h = harness(now => ({ after: now === 0 ? 0 : now === 100 + REFETCH_DELAY_MS ? 9000 : 10 }));
  h.r.change();
  await h.run(0);
  await h.run(20_000, [100, 2500]);
  // The answer comes at 11100; the next request goes REFETCH_MAX_WAIT_MS after the change at 2500, not 2 s after 11100.
  assert.deepEqual(h.sent, [0, 2100, 2500 + REFETCH_MAX_WAIT_MS]);
});

test('a throwing page callback does not leave the refetcher stuck or reject unhandled', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const loading: boolean[] = [];
    const h = harness(() => ({ after: 10 }), {
      result: () => { throw new Error('render failed'); },
      loading: on => { loading.push(on); if (!on) throw new Error('loading failed'); },
    });
    h.r.change();
    await h.run(100);
    assert.deepEqual(loading, [true, false]);
    assert.equal(h.r.clock.loaded, true);
    assert.equal(h.r.reload(), true, 'not stuck in flight');
    await h.run(100 + REFETCH_DELAY_MS);
    assert.deepEqual(h.sent, [0, 100 + REFETCH_DELAY_MS]);
    // A fetch that throws instead of returning a promise is a failure, not a crash.
    const errors: string[] = [];
    const t = createUsageRefetcher(() => { throw new Error('boom'); }, { result: () => {}, error: m => errors.push(m), loading: () => {} });
    t.change();
    await new Promise(ok => setTimeout(ok, 20));
    t.stop();
    assert.deepEqual(errors, ['boom']);
    await new Promise(ok => setImmediate(ok));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('usageKey moves with cost or tokens, so a cost-less session still triggers a refetch', () => {
  const s = (cost: number | null, output: number) => ({ cost, usage: { input: 10, output, cacheRead: 0, cacheWrite: 0 } });
  assert.equal(usageKey([s(1.25, 5)]), usageKey([s(1.25, 5)]));
  assert.notEqual(usageKey([s(null, 5)]), usageKey([s(null, 6)]));
  assert.notEqual(usageKey([s(1, 5)]), usageKey([s(1.01, 5)]));
  // A cost step and a token step that would cancel out in one sum still read as a change.
  assert.notEqual(usageKey([s(1, 5)]), usageKey([s(0.9999, 6)]));
});

test('project usage: per-folder answers, a failed reload keeps the old numbers marked stale (#522)', () => {
  const none = { data: null, stale: false, failed: false };
  assert.deepEqual(projectUsageShown(null, 'a'), none, 'loading before any answer');
  const a1 = projectUsageOk('a', 1);
  assert.deepEqual(projectUsageShown(a1, 'a'), { data: 1, stale: false, failed: false });
  assert.deepEqual(projectUsageShown(a1, 'b'), none, 'another project never shows a\'s numbers');
  const aFail = projectUsageFail(a1, 'a');
  assert.deepEqual(projectUsageShown(aFail, 'a'), { data: 1, stale: true, failed: false }, 'a failed reload says the numbers are old');
  assert.deepEqual(projectUsageShown(projectUsageOk('a', 2), 'a'), { data: 2, stale: false, failed: false }, 'a later success clears it');
  const bFail = projectUsageFail(a1, 'b');
  assert.deepEqual(projectUsageShown(bFail, 'b'), { data: null, stale: false, failed: true }, 'a failed first load of b borrows nothing from a');
  assert.deepEqual(projectUsageShown(projectUsageFail(bFail, 'b'), 'b'), { data: null, stale: false, failed: true });
  assert.deepEqual(projectUsageShown(projectUsageFail(null, 'a'), 'a'), { data: null, stale: false, failed: true });
});
