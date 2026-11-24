import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollWhileVisible, relativeTime } from '../../web/src/home/model.ts';

function fakePage(state: 'visible' | 'hidden') {
  const listeners = new Set<() => void>();
  const timers = new Map<number, () => void>();
  let id = 0;
  return {
    doc: {
      visibilityState: state as string,
      addEventListener: (_: 'visibilitychange', fn: () => void) => void listeners.add(fn),
      removeEventListener: (_: 'visibilitychange', fn: () => void) => void listeners.delete(fn),
    },
    timers: { setInterval: (fn: () => void) => (timers.set(++id, fn), id), clearInterval: (t: unknown) => void timers.delete(t as number) },
    tick: () => [...timers.values()].forEach((fn) => fn()),
    show(next: 'visible' | 'hidden') {
      this.doc.visibilityState = next;
      listeners.forEach((fn) => fn());
    },
    get counts() {
      return { timers: timers.size, listeners: listeners.size };
    },
  };
}

test('pollWhileVisible: polls while visible, stops while hidden, loads at once when shown again', () => {
  const page = fakePage('visible');
  let loads = 0;
  const stop = pollWhileVisible(() => loads++, 10_000, page.doc, page.timers);
  assert.equal(loads, 1, 'loads right away');
  page.tick();
  assert.equal(loads, 2);
  page.show('hidden');
  assert.equal(page.counts.timers, 0, 'no timer while hidden');
  page.tick();
  assert.equal(loads, 2);
  page.show('visible');
  assert.equal(loads, 3, 'catches up as soon as it shows');
  assert.equal(page.counts.timers, 1);
  stop();
  assert.deepEqual(page.counts, { timers: 0, listeners: 0 });
});

test('pollWhileVisible: a page opened hidden waits until it shows', () => {
  const page = fakePage('hidden');
  let loads = 0;
  pollWhileVisible(() => loads++, 10_000, page.doc, page.timers);
  assert.equal(loads, 0);
  assert.equal(page.counts.timers, 0);
  page.show('visible');
  assert.equal(loads, 1);
});

test('relativeTime in Korean', () => {
  const now = 1_000_000_000_000;
  assert.equal(relativeTime(now - 5 * 60_000, now), '5분 전');
  assert.equal(relativeTime(now - 3 * 3_600_000, now), '3시간 전');
  assert.equal(relativeTime(0, now), '-');
});
