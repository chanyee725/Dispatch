import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byUrgency, stateStart } from '../../web/src/dispatch/lib/order.ts';
import type { SessionState } from '../../shared/dispatch/types.ts';

type S = { id: string; startedAt: number; stateSince?: number; stuck?: { reason: string; label: string; sinceMs: number | null } | null; st: SessionState };
const mk = (id: string, st: SessionState, startedAt: number, stateSince?: number): S => ({ id, st, startedAt, stateSince });

test('failed, waiting, stuck, working, resting, done', () => {
  const list = [mk('d', 'done', 1), mk('r', 'resting', 1), mk('w', 'working', 1), mk('s', 'stuck', 1), mk('q', 'waiting', 1), mk('f', 'failed', 1)];
  assert.deepEqual(byUrgency(list, s => s.st).map(s => s.id), ['f', 'q', 's', 'w', 'r', 'd']);
});

test('inside one state the longest-standing comes first, then start time, then id', () => {
  const list = [mk('b', 'waiting', 5, 30), mk('a', 'waiting', 9, 10), mk('d', 'working', 2), mk('c', 'working', 2)];
  assert.deepEqual(byUrgency(list, s => s.st).map(s => s.id), ['a', 'b', 'c', 'd']);
});

test('returns a new array and leaves the input alone', () => {
  const list = [mk('w', 'working', 1), mk('f', 'failed', 1)];
  const out = byUrgency(list, s => s.st);
  assert.notEqual(out, list);
  assert.deepEqual(list.map(s => s.id), ['w', 'f']);
});

test('a stuck session counts from when it went quiet', () => {
  const s = { ...mk('x', 'stuck', 1, 50), stuck: { reason: 'silent', label: '조용함', sinceMs: 20 } };
  assert.equal(stateStart(s, 'stuck'), 20);
  assert.equal(stateStart(s, 'working'), 50);
  assert.equal(stateStart(mk('y', 'working', 7), 'working'), 7);
});
