import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentMeta, agentStateLabel, agentsIn, isBusy, isEditingDiagram, roleBadge, needsLook, fileStem, parseAgents, safeColor, type AgentPresence } from '../../web/src/home/agents.ts';

const a = (sid: string, x: Partial<AgentPresence> = {}): AgentPresence => ({ sid, name: sid, role: 'impl', model: null, status: 'waiting', state: 'resting', project: null, file: null, at: 0, ...x });

test('agentsIn keeps the project\'s agents (by folder or held file) in creation order', () => {
  const all = [
    a('Idle', { project: 'P', n: 4, at: 5 }),
    a('Holder', { project: 'P', n: 3, file: 'P/x.dpx.json', at: 1 }),
    a('Busy', { project: 'P', n: 2, status: 'running', state: 'working', at: 0 }),
    a('ByFile', { n: 1, file: 'P/sub/y.dpx.json', status: 'running', state: null, at: null }),
    a('Other', { project: 'Q', n: 5, state: 'working', file: 'Q/z.dpx.json' }),
    a('Prefix', { n: 6, file: 'PX/z.dpx.json' }),
  ];
  assert.deepEqual(agentsIn(all, 'P').map((x) => x.sid), ['ByFile', 'Busy', 'Holder', 'Idle']);
  // '' = the whole project this server belongs to (#778): every agent.
  assert.equal(agentsIn(all, '').length, all.length);
});

test('agentsIn: fixed team order (lead, then its teammates), never moved by activity (#785)', () => {
  const list = (busy: string, at: (sid: string) => number) => [
    a('impl2', { n: 4, parent: 'lead1', at: at('impl2') }),
    a('lead2', { n: 3, role: 'lead', at: at('lead2') }),
    a('ext', { outside: true, status: 'running', state: 'working', at: at('ext') }),
    a('impl1', { n: 2, parent: 'lead1', at: at('impl1') }),
    a('lead1', { n: 1, role: 'lead', at: at('lead1') }),
    a('rev', { n: 5, parent: 'lead2', at: at('rev') }),
    a('orphan', { n: 6, parent: 'gone', at: at('orphan') }),
  ].map((x) => (x.sid === busy ? { ...x, status: 'running', state: 'working' } : x));
  const want = ['lead1', 'impl1', 'impl2', 'lead2', 'rev', 'orphan', 'ext'];
  assert.deepEqual(agentsIn(list('rev', () => 0), '').map((x) => x.sid), want);
  // Other activity times and another busy session: same order.
  assert.deepEqual(agentsIn(list('impl2', (sid) => sid.length * 1000), '').map((x) => x.sid), want);
  assert.deepEqual(agentsIn(list('lead1', (sid) => -sid.charCodeAt(0)), '').map((x) => x.sid), want);
});

test('meta, colours and parsing', () => {
  assert.equal(agentMeta(a('A', { roleName: '구현자', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5' })), '구현자 · Opus 5.5');
  assert.equal(agentMeta(a('A', { role: 'impl' })), 'impl');
  assert.equal(agentMeta(a('A', { outside: true })), '외부 API');
  assert.equal(safeColor('#12abEF'), '#12abEF');
  assert.equal(safeColor('red;background:url(x)'), null);
  assert.equal(fileStem('P/02-화면-지도.dpx.json'), '02-화면-지도');
  assert.deepEqual(parseAgents(null), []);
  assert.deepEqual(parseAgents({ agents: [a('A'), { name: 1 }, null] }).map((x) => x.sid), ['A']);
});

test('state label and dots: the monitoring state wins, the hub status fills in when it is not known yet', () => {
  assert.equal(agentStateLabel(a('A', { status: 'running', state: 'working' })), '작업 중');
  assert.equal(agentStateLabel(a('A', { status: 'waiting', state: 'waiting' })), '사람 기다림');
  assert.equal(agentStateLabel(a('A', { status: 'starting', state: null })), '시작 중');
  assert.equal(agentStateLabel(a('A', { status: 'odd', state: null })), 'odd');
  assert.equal(isBusy(a('A', { status: 'running', state: 'resting' })), false);
  assert.equal(isBusy(a('A', { status: 'starting', state: null })), true);
  // #785: an idle or waiting session is listed but never busy, whatever a stale monitor state says.
  assert.equal(isBusy(a('A', { status: 'idle', state: 'working' })), false);
  assert.equal(isBusy(a('A', { status: 'waiting', state: null })), false);
  assert.equal(isBusy(a('A', { status: 'running', state: 'working' })), true);
  assert.equal(agentStateLabel(a('A', { status: 'idle', state: null })), '쉼');
  assert.equal(needsLook(a('A', { state: 'stuck' })), true);
  assert.equal(needsLook(a('A', { status: 'waiting', state: null })), true);
});

test('isEditingDiagram: only while the cursor status says diagram and a file is held (#793)', () => {
  const f = 'P/x.dpx.json';
  assert.equal(isEditingDiagram(a('w', { status: 'running', file: f, statusLabel: '다이어그램 작성 중…' })), true);
  assert.equal(isEditingDiagram(a('t', { status: 'running', file: f, statusLabel: '다이어그램 생각 중…' })), true);
  assert.equal(isEditingDiagram(a('doc', { status: 'running', file: f, statusLabel: '글 작성 중…' })), false);
  assert.equal(isEditingDiagram(a('code', { status: 'running', file: f, statusLabel: '코드 작성 중…' })), false);
  assert.equal(isEditingDiagram(a('idle', { status: 'idle', file: f })), false);
  assert.equal(isEditingDiagram(a('nofile', { status: 'running', statusLabel: '다이어그램 작성 중…' })), false);
  assert.equal(isEditingDiagram(a('ext', { outside: true, file: f, statusLabel: '다이어그램 작성 중…' })), false);
});

test('roleBadge: tone from the role id, label always text (#793)', () => {
  assert.deepEqual(roleBadge({ role: 'lead', roleName: '관리자' }), { tone: 'lead', label: '관리자' });
  assert.deepEqual(roleBadge({ role: 'impl' }), { tone: 'impl', label: '구현자' });
  assert.deepEqual(roleBadge({ role: 'docs', roleName: '문서화' }), { tone: 'docs', label: '문서화' });
  assert.deepEqual(roleBadge({ role: 'lead', roleName: '병합 관리자' }), { tone: 'merge', label: '병합 관리자' });
  assert.deepEqual(roleBadge({ role: 'merge' }), { tone: 'merge', label: '머지 담당' });
  assert.deepEqual(roleBadge({ role: 'custom', roleName: '분석가' }), { tone: 'other', label: '분석가' });
  assert.deepEqual(roleBadge({ role: '', outside: true }), { tone: 'other', label: '외부 API' });
});
