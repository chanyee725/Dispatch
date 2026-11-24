import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { apply, connect, forgetTranscript, getState, loadTranscript, mergeEntries, resetState, setState } from '../../web/src/dispatch/store.ts';
import type { Entry, Session } from '../../shared/dispatch/types.ts';

const sess = (id: string, extra: Partial<Session> = {}) => ({ id, name: id, status: 'running', pending: [], ...extra }) as unknown as Session;
const entry = (text: string): Entry => ({ kind: 'assistant', text, at: 1 });

beforeEach(() => resetState());

test('snapshot fills the state and marks it ready and online', () => {
  apply('snapshot', { sessions: [sess('a')], tasks: [], roles: [] });
  const s = getState();
  assert.equal(s.ready, true);
  assert.equal(s.online, true);
  assert.deepEqual(s.sessions.map(x => x.id), ['a']);
});

test('session updates in place or adds to the front', () => {
  apply('session', sess('a'));
  apply('session', sess('b'));
  apply('session', sess('a', { name: 'renamed' }));
  assert.deepEqual(getState().sessions.map(x => [x.id, x.name]), [['b', 'b'], ['a', 'renamed']]);
});

test('removed drops the session and its transcript, and a late update does not bring it back', () => {
  apply('session', sess('a'));
  setState({ transcripts: { a: [entry('hi')] } });
  apply('removed', { id: 'a' });
  assert.equal(getState().sessions.length, 0);
  assert.equal('a' in getState().transcripts, false);
  apply('session', sess('a'));
  assert.equal(getState().sessions.length, 0);
});

test('message appends only to a transcript already loaded', () => {
  apply('message', { id: 'a', entry: entry('x') });
  assert.equal('a' in getState().transcripts, false);
  setState({ transcripts: { a: [] } });
  apply('message', { id: 'a', entry: entry('x') });
  assert.deepEqual(getState().transcripts.a?.map(e => e.text), ['x']);
});

test('list and settings events replace their slice; unknown events are ignored', () => {
  const before = getState();
  apply('prefs', { theme: 'dark' });
  assert.equal(getState(), before);
  apply('tasks', [{ id: 't1' }]);
  apply('limits', { five: 0.5 });
  assert.deepEqual(getState().tasks, [{ id: 't1' }]);
  assert.deepEqual(getState().limits, { five: 0.5 });
});

test('forgetTranscript drops one transcript from memory', () => {
  setState({ transcripts: { a: [entry('x')], b: [] } });
  forgetTranscript('a');
  assert.deepEqual(Object.keys(getState().transcripts), ['b']);
});

test('connecting again applies the current /api/state even after the first visit', async () => {
  const real = globalThis.fetch;
  let snap: unknown = { sessions: [sess('old')] };
  globalThis.fetch = (async () => new Response(JSON.stringify(snap), { status: 200 })) as typeof fetch;
  try {
    const settle = () => new Promise(r => setTimeout(r, 0));
    const close = connect();
    await settle();
    assert.deepEqual(getState().sessions.map(x => x.id), ['old']);
    close();
    // The shared stream stays open elsewhere, so no new stream snapshot comes; the fetch must refresh the state.
    snap = { sessions: [sess('new')] };
    const close2 = connect();
    await settle();
    assert.deepEqual(getState().sessions.map(x => x.id), ['new']);
    close2();
  } finally {
    globalThis.fetch = real;
  }
});

// Controllable /api/state: each call waits until the test answers it.
function fakeFetch() {
  const calls: { resolve: (body: unknown, status?: number) => void }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>(r => {
    calls.push({ resolve: (body, status = 200) => r(new Response(JSON.stringify(body), { status })) });
  })) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const settle = () => new Promise(r => setTimeout(r, 0));
const ids = () => getState().sessions.map(x => x.id);

test('a stale /api/state answer never overwrites a newer one, and one after close is dropped', async () => {
  const f = fakeFetch();
  try {
    const close1 = connect();
    close1();
    const close2 = connect();
    f.calls[1].resolve({ sessions: [sess('new')] });
    await settle();
    f.calls[0].resolve({ sessions: [sess('old')] });
    await settle();
    assert.deepEqual(ids(), ['new']);
    close2();
    const close3 = connect();
    close3();
    f.calls[2].resolve({ sessions: [sess('late')] });
    await settle();
    assert.deepEqual(ids(), ['new']);
  } finally {
    f.restore();
  }
});

test('a stream snapshot that arrives before the fetch wins over the fetched one', async () => {
  const f = fakeFetch();
  try {
    const close = connect();
    apply('snapshot', { sessions: [sess('streamed')] });
    f.calls[0].resolve({ sessions: [sess('fetched')] });
    await settle();
    assert.deepEqual(ids(), ['streamed']);
    close();
  } finally {
    f.restore();
  }
});

test('events received while fetching survive the fetched snapshot; a deleted session stays gone', async () => {
  const f = fakeFetch();
  try {
    const close = connect();
    apply('removed', { id: 'x' });
    apply('session', sess('y', { name: 'live' }));
    apply('session', sess('z'));
    apply('tasks', [{ id: 'live-task' }]);
    f.calls[0].resolve({ sessions: [sess('x'), sess('y', { name: 'stale' }), sess('w')], tasks: [{ id: 'stale-task' }], roles: [] });
    await settle();
    assert.deepEqual(getState().sessions.map(s => [s.id, s.name]), [['z', 'z'], ['y', 'live'], ['w', 'w']]);
    assert.deepEqual(getState().tasks, [{ id: 'live-task' }]);
    assert.equal(getState().ready, true);
    close();
  } finally {
    f.restore();
  }
});

test('a stream snapshot is filtered by the deleted ids too', () => {
  apply('removed', { id: 'x' });
  apply('snapshot', { sessions: [sess('x'), sess('y')] });
  assert.deepEqual(ids(), ['y']);
});

test('after the stream closes for good (404, 502) it reconnects with backoff and refetches /api/state', async (t) => {
  class FakeES {
    static all: FakeES[] = [];
    readyState = 0;
    onopen: ((e: Event) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    constructor() { FakeES.all.push(this); }
    addEventListener() {}
    close() { this.readyState = 2; }
  }
  const g = globalThis as { EventSource?: unknown };
  g.EventSource = FakeES;
  const f = fakeFetch();
  try {
    const close = connect();
    f.calls[0].resolve({ sessions: [sess('before')] });
    FakeES.all[0].onopen?.({} as Event);
    await settle();
    assert.equal(getState().online, true);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    FakeES.all[0].readyState = 2; // e.g. the server answered 502 while restarting
    FakeES.all[0].onerror?.({} as Event);
    assert.equal(getState().online, false);
    t.mock.timers.tick(1000);
    assert.equal(FakeES.all.length, 2, 'a new stream is opened');
    FakeES.all[1].onopen?.({} as Event);
    assert.equal(f.calls.length, 2, '/api/state is fetched again');
    t.mock.timers.reset();
    f.calls[1].resolve({ sessions: [sess('after')] });
    await settle();
    assert.deepEqual(ids(), ['after']);
    assert.equal(getState().online, true);
    close();
  } finally {
    t.mock.timers.reset();
    delete g.EventSource;
    f.restore();
  }
});

// #207: live messages that arrive while the transcript request is in flight.
const msg = (id: number, text = `m${id}`): Entry => ({ kind: 'assistant', text, at: id, id });
const texts = (id: string) => getState().transcripts[id]?.map(e => e.text);

test('mergeEntries appends only live entries the loaded history lacks, by id', () => {
  assert.deepEqual(mergeEntries([msg(1), msg(2)], [msg(2), msg(3), msg(3)]).map(e => e.id), [1, 2, 3]);
  const old = (text: string): Entry => ({ kind: 'user', text, at: 5 }); // no id: compared by content
  assert.deepEqual(mergeEntries([old('a')], [old('a'), old('b')]).map(e => e.text), ['a', 'b']);
});

test('messages arriving while the transcript loads are kept, without duplicates', async () => {
  const f = fakeFetch();
  try {
    const p = loadTranscript('a');
    apply('message', { id: 'a', entry: msg(2) }); // already in the answer below
    apply('message', { id: 'a', entry: msg(3) }); // sent after the server built the answer
    apply('message', { id: 'b', entry: msg(9) }); // another session: not buffered here
    f.calls[0].resolve({ messages: [msg(1), msg(2)] });
    await p;
    assert.deepEqual(texts('a'), ['m1', 'm2', 'm3']);
    assert.equal('b' in getState().transcripts, false);
    apply('message', { id: 'a', entry: msg(4) }); // after the load: appended as before
    assert.deepEqual(texts('a'), ['m1', 'm2', 'm3', 'm4']);
  } finally { f.restore(); }
});

test('reloading a loaded transcript keeps live messages and drops a stale answer', async () => {
  const f = fakeFetch();
  try {
    setState({ transcripts: { a: [msg(1)] } });
    const first = loadTranscript('a');
    const second = loadTranscript('a');
    apply('message', { id: 'a', entry: msg(2) });
    f.calls[1].resolve({ messages: [msg(1)] });
    await second;
    f.calls[0].resolve({ messages: [] }); // the older request answers last: ignored
    await first;
    assert.deepEqual(texts('a'), ['m1', 'm2']);
  } finally { f.restore(); }
});

test('a session removed during the load does not get its transcript back', async () => {
  const f = fakeFetch();
  try {
    apply('session', sess('a'));
    const p = loadTranscript('a');
    apply('removed', { id: 'a' });
    f.calls[0].resolve({ messages: [msg(1)] });
    await p;
    assert.equal('a' in getState().transcripts, false);
  } finally { f.restore(); }
});
