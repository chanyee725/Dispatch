// Agent live view client helpers (E559, #728): hash sync, the raw-text sid filter, display formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFromHash, closeAgentLive, followHash, openAgentLive, resetLiveStore, withAgent } from '../../web/src/live/store.ts';
import { eventFor } from '../../web/src/live/useAgentLive.ts';
import { Hub } from '../../server/dispatch/hub.js';
import { clock, liveStateLabel, middle, span, waitNote } from '../../web/src/live/format.ts';

test('the agent= hash part is read and written without touching the file part', () => {
  assert.equal(agentFromHash('#file=a.dpx.json&agent=s1'), 's1');
  assert.equal(agentFromHash('#agent=s%2F1'), 's/1');
  assert.equal(agentFromHash('#file=a.dpx.json'), null);
  assert.equal(agentFromHash('#file=x&h=agent=no'), null);
  assert.equal(withAgent('#file=a.dpx.json', 's1'), '#file=a.dpx.json&agent=s1');
  assert.equal(withAgent('#file=a.dpx.json&agent=old', 's2'), '#file=a.dpx.json&agent=s2');
  assert.equal(withAgent('#file=a.dpx.json&agent=s1', null), '#file=a.dpx.json');
  assert.equal(withAgent('', 's1'), '#agent=s1');
  assert.equal(withAgent('#agent=s1', null), '');
});

test('events of other agents are dropped from the raw text, before parsing', () => {
  const sid = 'a1b2';
  assert.equal(eventFor(JSON.stringify({ sid, current: null }), 'sid', sid)?.sid, sid);
  assert.equal(eventFor(JSON.stringify({ sid: 'a1b2c', current: null }), 'sid', sid), null);
  assert.equal(eventFor(JSON.stringify({ id: sid, n: 1 }), 'id', sid)?.id, sid);
  // Key order does not matter; a nested or other-key match does not count.
  assert.equal(eventFor(JSON.stringify({ n: 1, name: 'x', id: sid }), 'id', sid)?.id, sid);
  assert.equal(eventFor(JSON.stringify({ id: 'zz', parent: sid }), 'id', sid), null);
  assert.equal(eventFor(JSON.stringify({ id: 'zz', child: { id: sid } }), 'id', sid), null);
  assert.equal(eventFor('{"id":"a1b2"', 'id', sid), null);
});

test('the sid filter matches the session events the hub really sends, whatever the stored key order', () => {
  // A stored session whose id is not its first key (e.g. read back from an older store file).
  const s = { name: 'x', status: 'idle', cwd: '/tmp/scratch', updatedAt: 1, id: 'k9', parent: null };
  const hub = Object.assign(Object.create(Hub.prototype), { live: new Map(), store: { save() {}, data: { sessions: { [s.id]: s } } } });
  const raw = JSON.stringify(hub.publicSession(s));
  assert.equal(eventFor<{ id: string }>(raw, 'id', 'k9')?.id, 'k9');
  assert.equal(eventFor(raw, 'id', 'k'), null);
  assert.equal(eventFor(JSON.stringify({ id: 'k9' }), 'id', 'k9')?.id, 'k9', 'the removed event');
});

test('the panel follows back/forward and a pasted hash, without writing the hash back', () => {
  const g = globalThis as unknown as { window?: unknown };
  const had = 'window' in g;
  const prev = g.window;
  let writes = 0;
  const loc = { pathname: '/', search: '', hash: '#file=a.dpx.json' };
  g.window = { location: loc, history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => { writes++; loc.hash = url.slice(1); } } };
  try {
    resetLiveStore();
    openAgentLive('s1', { trigger: null });
    assert.equal(loc.hash, '#file=a.dpx.json&agent=s1');
    writes = 0;
    // Back to an entry without agent=: the panel closes, nothing is written.
    loc.hash = '#file=a.dpx.json';
    followHash();
    assert.equal(writes, 0);
    openAgentLive('s1', { trigger: null });
    assert.equal(loc.hash, '#file=a.dpx.json&agent=s1', 'it was closed, so this opens it again rather than toggling off');
    // A pasted hash naming another agent switches to it.
    writes = 0;
    loc.hash = '#file=a.dpx.json&agent=s2';
    followHash();
    followHash();
    assert.equal(writes, 0);
    openAgentLive('s2', { trigger: null });
    assert.equal(loc.hash, '#file=a.dpx.json', 's2 was open, so the same sid toggles it off');
    closeAgentLive();
  } finally {
    resetLiveStore();
    if (had) g.window = prev;
    else delete g.window;
  }
});

test('display formats', () => {
  assert.equal(span(42_000), '42초');
  assert.equal(span(12 * 60_000), '12분');
  assert.equal(span(64 * 60_000), '1시간 4분');
  assert.equal(clock(42_000), '0:42');
  assert.equal(clock(3_723_000), '1:02:03');
  assert.equal(middle('short'), 'short');
  const m = middle('server/dispatch/very/long/path/to/some/file/app.js', 20);
  assert.equal(m.length, 20);
  assert.ok(m.includes('…') && m.endsWith('app.js'));
  assert.equal(liveStateLabel('working', false), '생각 중');
  assert.equal(liveStateLabel('working', true), '작업 중');
  assert.equal(liveStateLabel('done', false), '끝났어요');
});

test('waitNote: a question is not called a permission prompt, and is never blank (#886)', () => {
  assert.equal(waitNote({ pending: [], status: 'idle', ask: '머지할까요?' }), '답을 기다려요: 머지할까요?');
  assert.equal(waitNote({ pending: [{}], status: 'running' }), '권한 요청이 있어요');
  assert.equal(waitNote({ pending: [], status: 'waiting' }), '권한 요청이 있어요');
  assert.equal(waitNote({ pending: [], status: 'idle' }), '답을 기다려요(내용 없음)');
  assert.equal(waitNote(null), '답을 기다려요(내용 없음)');
});
