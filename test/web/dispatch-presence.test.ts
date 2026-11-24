import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presenceOf } from '../../web/src/dispatch/lib/presence.ts';
import { stateOf } from '../../web/src/dispatch/lib/format.ts';

const base = { id: 's1', n: 2, name: 'Otto', role: 'impl', roleName: '구현자', provider: 'claude', model: 'm', modelLabel: 'Opus 5.5', effort: 'low', status: 'running', startedAt: 1, updatedAt: 5, folder: 'a', parent: null };
const p = (more: Record<string, unknown> = {}) => presenceOf({ ...base, ...more } as never, stateOf as never);

test('presenceOf: card fields come from the session, the model label carries the effort', () => {
  const a = p({ activity: { label: '코드 읽기', since: 1 } });
  assert.equal(a.sid, 's1');
  assert.equal(a.modelLabel, 'Opus 5.5 low');
  assert.equal(a.statusLabel, '코드 읽기');
  assert.equal(a.project, 'a');
  assert.equal(a.file, null);
  assert.equal(a.state, 'working');
});

test('presenceOf: a session that needs a person shows why instead of the activity', () => {
  const a = p({ status: 'waiting', state: 'waiting', attention: { reason: '허가를 기다려요' }, activity: { label: '코드 읽기', since: 1 } });
  assert.equal(a.statusLabel, '허가를 기다려요');
  assert.equal(a.state, 'waiting');
});
