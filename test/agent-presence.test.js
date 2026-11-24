// Live agent list (E528): live hub sessions with their project folder, GET + `agents` SSE. Memory only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as agents from '../server/cursor/agents.js';

const { buildAgents } = agents;

test('buildAgents: live sessions only, project filter by folder, newest first', () => {
  const sessions = [
    { id: 'a', name: 'A', role: 'impl', status: 'idle', folder: 'alpha', updatedAt: 1, model: 'm' },
    { id: 'b', name: 'B', role: 'lead', status: 'running', folder: 'beta', updatedAt: 3 },
    { id: 'c', name: 'C', role: 'impl', status: 'done', folder: 'alpha', updatedAt: 5 },
  ];
  const all = buildAgents({ sessions, activity: new Map([['b', '테스트 중']]) });
  assert.deepEqual(all.map((x) => x.sid), ['b', 'a']);
  assert.equal(all[0].activity, '테스트 중');
  assert.equal(all[1].file, null);
  assert.deepEqual(buildAgents({ sessions, project: 'alpha' }).map((x) => x.sid), ['a']);
});

test('agents module: lists hub sessions, broadcasts changes, empty without Dispatch', async () => {
  const hub = Object.assign(new EventEmitter(), { sessions: [{ id: 'a', name: 'A', status: 'running', folder: 'alpha' }] });
  const sent = [];
  const ctx = { modules: { dispatch: { hub } }, hub: { broadcast: (k, v) => sent.push([k, v]), onAttach() {} } };
  const m = await agents.setup(ctx);
  assert.equal(m.list().length, 1);
  hub.emit('session', { id: 'a', activity: { label: '읽는 중' } });
  assert.equal(sent.at(-1)[1].agents[0].activity, '읽는 중');
  m.close();
  const off = await agents.setup({ modules: {}, hub: { broadcast() {}, onAttach() {} } });
  assert.deepEqual(off.list(), []);
});
