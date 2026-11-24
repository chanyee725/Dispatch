import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventsClient } from '../../web/src/lib/events.ts';

class FakeSource {
  closed = false;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners = new Map<string, ((e: Event) => void)[]>();
  addEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data } as unknown as Event);
  }
}

function setup() {
  const sources: FakeSource[] = [];
  const client = createEventsClient(() => {
    const s = new FakeSource();
    sources.push(s);
    return s;
  });
  return { sources, client };
}

test('many subscribers share one connection and it closes after the last leaves', () => {
  const { sources, client } = setup();
  const offA = client.subscribe('run', () => {});
  const offB = client.subscribe('workspace', () => {});
  const offC = client.onConnection(() => {});
  assert.equal(sources.length, 1);
  offA();
  offB();
  assert.equal(sources[0].closed, false);
  offC();
  assert.equal(sources[0].closed, true);
  client.subscribe('run', () => {});
  assert.equal(sources.length, 2, 'a new subscriber after the close opens a fresh connection');
});

test('events reach only the subscribers of their type; unsubscribed handlers stop', () => {
  const { sources, client } = setup();
  const run: string[] = [];
  const other: string[] = [];
  const off = client.subscribe('run', (d) => run.push(d));
  client.subscribe('run', (d) => other.push(d));
  const ws: string[] = [];
  client.subscribe('workspace', (d) => ws.push(d));
  sources[0].emit('run', 'a');
  sources[0].emit('workspace', 'w');
  off();
  sources[0].emit('run', 'b');
  assert.deepEqual(run, ['a']);
  assert.deepEqual(other, ['a', 'b']);
  assert.deepEqual(ws, ['w']);
});

test('subscribeJson parses data and skips what does not parse', () => {
  const { sources, client } = setup();
  const got: unknown[] = [];
  client.subscribeJson('pipeline', (e) => got.push(e));
  sources[0].emit('pipeline', '{"path":"a.md"}');
  sources[0].emit('pipeline', 'not json');
  assert.deepEqual(got, [{ path: 'a.md' }]);
});

test('onConnection reports open and error, and tells a late watcher the stream is already open', () => {
  const { sources, client } = setup();
  const a: boolean[] = [];
  client.onConnection((o) => a.push(o));
  sources[0].onopen?.({} as Event);
  sources[0].onerror?.({} as Event);
  sources[0].onopen?.({} as Event); // the browser reconnected
  assert.deepEqual(a, [true, false, true]);
  const b: boolean[] = [];
  client.onConnection((o) => b.push(o));
  assert.deepEqual(b, [true]);
});

test('without EventSource nothing opens and subscribing is harmless', () => {
  const client = createEventsClient(() => null);
  const off = client.subscribe('run', () => {});
  client.onConnection(() => {})();
  off();
});

test('a stream the browser closed for good (404, 502) is reopened after a growing delay', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sources: FakeSource[] = [];
  const client = createEventsClient(() => {
    const s = new FakeSource();
    sources.push(s);
    return s;
  }, { baseMs: 100, maxMs: 300 });
  const got: string[] = [];
  const online: boolean[] = [];
  client.subscribe('run', (d) => got.push(d));
  const offConn = client.onConnection((o) => online.push(o));
  const fail = (s: FakeSource) => {
    (s as FakeSource & { readyState: number }).readyState = 2;
    s.onerror?.({} as Event);
  };

  // A transient error the browser retries itself does not open a second stream.
  sources[0].onerror?.({} as Event);
  t.mock.timers.tick(1000);
  assert.equal(sources.length, 1);

  fail(sources[0]);
  assert.equal(sources[0].closed, true);
  t.mock.timers.tick(99);
  assert.equal(sources.length, 1);
  t.mock.timers.tick(1);
  assert.equal(sources.length, 2, 'reopened after 100 ms');
  sources[1].emit('run', 'a');
  assert.deepEqual(got, ['a'], 'handlers are wired to the new stream');

  fail(sources[1]);
  t.mock.timers.tick(199);
  assert.equal(sources.length, 2);
  t.mock.timers.tick(1);
  assert.equal(sources.length, 3, 'second try waits 200 ms');
  fail(sources[2]);
  t.mock.timers.tick(300);
  assert.equal(sources.length, 4, 'capped at maxMs');

  sources[3].onopen?.({} as Event);
  fail(sources[3]);
  t.mock.timers.tick(100);
  assert.equal(sources.length, 5, 'a successful open resets the delay');
  sources[0].onopen?.({} as Event); // a stale source must not report online
  assert.deepEqual(online, [false, false, false, false, true, false]);

  fail(sources[4]);
  offConn();
  client.subscribe('x', () => {})(); // still one 'run' subscriber: retry stays scheduled, no extra stream
  assert.equal(sources.length, 5);
  t.mock.timers.tick(200);
  assert.equal(sources.length, 6);
});

test('the last subscriber leaving cancels a pending reopen', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sources, client } = setup();
  const off = client.subscribe('run', () => {});
  (sources[0] as FakeSource & { readyState: number }).readyState = 2;
  sources[0].onerror?.({} as Event);
  off();
  t.mock.timers.tick(60000);
  assert.equal(sources.length, 1);
});
