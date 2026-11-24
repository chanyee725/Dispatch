// E537 agent activity log (#654): the pure log rules, the sentence copy and the server module (store + read state).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActivityLog } from '../server/cursor/activity-log.js';
import { setup } from '../server/cursor/activity.js';
import { ACTIVITY_MAX, activitySentence, fileStemOf, objectOf, parseActivityLog, subjectOf } from '../shared/dispatch/agent-activity.ts';

const sessions = {
  s1: { id: 's1', name: 'Jude', role: 'impl', provider: 'claude', color: '#3b82f6', status: 'running' },
  s2: { id: 's2', name: '민수', role: 'review', provider: 'Not A Provider', color: 'red', status: 'running' },
};

function logRig() {
  const out = [];
  let t = 1000;
  const log = createActivityLog({ emit: (e) => out.push(e), session: (sid) => sessions[sid] ?? null, now: () => ++t });
  return { log, out, kinds: () => out.map((e) => [e.kind, e.sid, e.file, e.section ?? null]) };
}

test('activity log: start on the first edit, progress once per section left, finish on leaving', () => {
  const { log, out, kinds } = logRig();
  log.held({ sid: 's1', file: 'a.dpx.json', section: '1. 개요' });
  log.held({ sid: 's1', file: 'a.dpx.json', section: '1. 개요' });
  log.held({ sid: 's1', file: 'a.dpx.json' }); // a canvas edit: no section, no event
  log.held({ sid: 's1', file: 'a.dpx.json', section: '2. 설계' });
  log.held({ sid: 's1', file: 'a.dpx.json', section: '1. 개요' });
  log.held({ sid: 's1', file: 'a.dpx.json', section: '2. 설계' }); // back to 1 and on again: 1 already counted, 2 is new
  log.held({ sid: 's1', file: 'b.dpx.json' }); // another file: finish a, start b
  log.held({ sid: 's1', gone: true });
  log.held({ sid: 's1', gone: true }); // nothing held: nothing
  assert.deepEqual(kinds(), [
    ['start', 's1', 'a.dpx.json', null],
    ['progress', 's1', 'a.dpx.json', '1. 개요'],
    ['progress', 's1', 'a.dpx.json', '2. 설계'],
    ['finish', 's1', 'a.dpx.json', null],
    ['start', 's1', 'b.dpx.json', null],
    ['finish', 's1', 'b.dpx.json', null],
  ]);
  // Metadata only: who, file, when, kind (and the colour when it is a real hex, the provider id when it looks like one).
  assert.deepEqual(Object.keys(out[0]).sort(), ['at', 'color', 'file', 'kind', 'name', 'provider', 'role', 'sid']);
  assert.equal(out[0].provider, 'claude');
  assert.equal(out[0].name, 'Jude');
  assert.ok(out.every((e, i) => i === 0 || e.at > out[i - 1].at));
  assert.equal(log.size, 0);
});

test('activity log: outside edits and bad reports are ignored; a bad colour is left out', () => {
  const { log, out } = logRig();
  log.held(null);
  log.held({ sid: 's1', file: 'a.dpx.json', outside: true });
  log.held({ sid: 's1', file: '' });
  log.held({ file: 'a.dpx.json' });
  assert.equal(out.length, 0);
  log.held({ sid: 's2', file: 'a.dpx.json' });
  assert.equal('color' in out[0], false);
  assert.equal('provider' in out[0], false);
  log.held({ sid: 'zz', file: 'a.dpx.json' });
  assert.deepEqual([out[1].name, out[1].role], ['', '']);
});

test('activity log: error once per stay when the session fails or gets stuck, again after it recovers', () => {
  const { log, kinds } = logRig();
  log.sessionUpdate({ id: 's1', state: 'failed' }); // holds nothing: nothing
  log.held({ sid: 's1', file: 'a.dpx.json' });
  log.sessionUpdate({ id: 's1', state: 'stuck' });
  log.sessionUpdate({ id: 's1', state: 'failed' });
  log.sessionUpdate({ id: 's1', state: 'ok' });
  log.sessionUpdate({ id: 's1', state: 'failed' });
  log.finish('s1');
  assert.deepEqual(kinds().map((k) => k[0]), ['start', 'error', 'error', 'finish']);
});

test('activitySentence: 해요체 copy with the right particles', () => {
  const e = { name: 'Jude', file: 'plans/07 서버 데이터 저장.dpx.json' };
  assert.equal(activitySentence({ ...e, kind: 'start' }), 'Jude가 07 서버 데이터 저장 작성을 시작했어요');
  assert.equal(activitySentence({ ...e, kind: 'progress', section: '섹션 3' }), 'Jude가 07 서버 데이터 저장의 ‘섹션 3’ 섹션을 진행했어요');
  assert.equal(activitySentence({ ...e, kind: 'progress' }), 'Jude가 07 서버 데이터 저장 작성을 진행했어요');
  assert.equal(activitySentence({ ...e, kind: 'finish', title: '저장 설계' }), 'Jude가 저장 설계 작업을 끝냈어요');
  assert.equal(activitySentence({ ...e, kind: 'error' }), 'Jude가 07 서버 데이터 저장 작업 중에 멈췄어요');
  assert.equal(activitySentence({ ...e, name: '', kind: 'finish' }), '에이전트가 07 서버 데이터 저장 작업을 끝냈어요');
  assert.equal(subjectOf('민수'), '민수가');
  assert.equal(subjectOf('준'), '준이');
  assert.equal(subjectOf('E7'), 'E7이');
  assert.equal(objectOf('표'), '표를');
  assert.equal(objectOf('문단'), '문단을');
  assert.equal(fileStemOf('a/b/c.dpx.json'), 'c');
});

test('parseActivityLog: malformed events are dropped, newest ACTIVITY_MAX kept', () => {
  const ev = (i) => ({ id: `${i}-1`, at: i, kind: 'start', sid: 's', name: 'n', role: 'impl', file: 'a.dpx.json' });
  const many = Array.from({ length: ACTIVITY_MAX + 5 }, (_, i) => ev(i + 1));
  const log = parseActivityLog({ events: [...many, { id: 'x' }, { ...ev(9999), kind: 'hack' }], readAt: 100 });
  assert.equal(log.events.length, ACTIVITY_MAX);
  assert.equal(log.events[0].at, 6);
  assert.deepEqual(parseActivityLog(null), { events: [] });
  assert.deepEqual(parseActivityLog({ events: 'x', readAt: 'y' }), { events: [] }, 'an old read mark is dropped');
});

// ---- server module ----

test('activity module: GET /api/activity answers the stored log; a damaged file starts empty', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'activity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ev = { id: '1-1', at: 1, kind: 'start', sid: 's', name: 'a', role: 'impl', file: 'x.dpx.json' };
  await mkdir(join(dir, '.drawing'), { recursive: true });
  await writeFile(join(dir, '.drawing', 'activity.json'), JSON.stringify({ version: 1, events: [ev] }));
  const call = async (m) => {
    let body = '';
    await m.routes[0].handler({}, { writeHead() {}, end: (b) => (body = b) });
    return JSON.parse(body);
  };
  const ctx = (d) => ({ workspaceDir: d, modules: {}, hub: { broadcast() {} } });
  const m = await setup(ctx(dir));
  assert.equal((await call(m)).events.length, 1);
  await m.close();
  await writeFile(join(dir, '.drawing', 'activity.json'), '{nope');
  const bad = await setup(ctx(dir));
  assert.deepEqual((await call(bad)).events, []);
  await bad.close();
});
