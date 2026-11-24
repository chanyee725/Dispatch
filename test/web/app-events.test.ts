// App events as toasts (E540 #671, #886, #969): a session's question and a long session's replacement. Metadata only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionEvents, toastOf } from '../../web/src/activity/appEvents.ts';

test('a session that starts waiting on a question raises a toast that opens it (#886)', () => {
  const base = { id: 's1', name: 'Ollie', role: 'lead', provider: 'claude' };
  const prev = { ...base, status: 'running', state: 'working' };
  const next = { ...base, status: 'idle', state: 'waiting', ask: '머지할까요?', stateSince: 500 };
  const [ev] = sessionEvents(prev, next, 600);
  const t = toastOf(ev)!;
  assert.equal(t.text, 'Ollie 세션이 답을 기다려요: 머지할까요?');
  assert.deepEqual(t.target, { session: 's1' });
  assert.equal(t.persist, true);
  // The same question re-sent (a reconnect, a cost update) says nothing new; a new question does.
  assert.deepEqual(sessionEvents(next, { ...next }, 700), []);
  assert.equal(sessionEvents(next, { ...next, ask: '배포할까요?', stateSince: 800 }, 800).length, 1);
  // A permission prompt (no ask) is not a question.
  assert.deepEqual(sessionEvents(prev, { ...base, status: 'waiting', state: 'waiting' }, 600), []);
});

test('a session that replaced a long one raises 누적 토큰 교체 with metadata only (#969)', () => {
  const next = { id: 's2', name: 'Nova', role: 'lead', provider: 'claude', startedAt: 1000, rotatedFrom: { id: 's1', name: 'Ollie', mtok: 16 } };
  const [ev] = sessionEvents(undefined, next, 1000);
  assert.deepEqual(ev, { type: 'session-rotated', id: 's2', name: 'Nova', role: 'lead', provider: 'claude', from: 'Ollie', mtok: 16 });
  const t = toastOf(ev)!;
  assert.equal(t.text, '누적 16M 토큰이라 새 세션 Nova로 바꿨어요');
  assert.equal(t.category, 'sessions');
  assert.deepEqual(t.target, { session: 's2' });
  // A reconnect long after the swap says nothing; a later update of the same session says nothing either.
  assert.deepEqual(sessionEvents(undefined, next, 1000 + 120_000), []);
  assert.deepEqual(sessionEvents(next, { ...next, status: 'idle' }, 1100), []);
});
