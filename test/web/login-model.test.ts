import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOGIN_POLL_EVERY_MS, LOGIN_POLL_LIMIT_MS, oneAtATime, pollLogins } from '../../web/src/settings/model.ts';

test('oneAtATime drops a second call while the first runs (double click)', async () => {
  let calls = 0;
  let release!: () => void;
  const run = oneAtATime(async () => {
    calls++;
    await new Promise<void>((r) => (release = r));
  });
  const first = run();
  assert.equal(await run(), false);
  release();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  // Free again after the first one ends, also after a throw.
  const failing = oneAtATime(async () => {
    calls++;
    throw new Error('boom');
  });
  await assert.rejects(failing());
  await assert.rejects(failing());
  assert.equal(calls, 3);
});

function fakeClock() {
  let t = 0;
  const timers = new Map<number, { fn: () => void; ms: number; next: number }>();
  let id = 0;
  return {
    now: () => t,
    setInterval: (fn: () => void, ms: number) => (timers.set(++id, { fn, ms, next: t + ms }), id),
    clearInterval: (h: unknown) => void timers.delete(h as number),
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.next <= end).sort((a, b) => a[1].next - b[1].next)[0];
        if (!due) break;
        t = due[1].next;
        due[1].next += due[1].ms;
        due[1].fn();
      }
      t = end;
    },
    get active() {
      return timers.size;
    },
  };
}

test('login polling: checks every 2 s, gives up once after 10 minutes, and a new round starts a fresh window', () => {
  const clock = fakeClock();
  let loads = 0;
  let gaveUp = 0;
  pollLogins(() => loads++, () => gaveUp++, clock);
  clock.advance(LOGIN_POLL_EVERY_MS * 3);
  assert.equal(loads, 3);
  clock.advance(LOGIN_POLL_LIMIT_MS);
  assert.equal(gaveUp, 1);
  assert.equal(clock.active, 0, 'the timer stops after giving up');
  const before = loads;
  clock.advance(60_000);
  assert.equal(loads, before, 'no checks after giving up');

  // 다시 확인: a new round polls again for another full window.
  pollLogins(() => loads++, () => gaveUp++, clock);
  clock.advance(LOGIN_POLL_LIMIT_MS - LOGIN_POLL_EVERY_MS);
  assert.ok(loads > before + 100);
  assert.equal(gaveUp, 1);
  clock.advance(LOGIN_POLL_EVERY_MS * 2);
  assert.equal(gaveUp, 2);
});

test('login polling: stop clears the timer', () => {
  const clock = fakeClock();
  let loads = 0;
  const stop = pollLogins(() => loads++, () => {}, clock);
  stop();
  clock.advance(10_000);
  assert.equal(loads, 0);
  assert.equal(clock.active, 0);
});

