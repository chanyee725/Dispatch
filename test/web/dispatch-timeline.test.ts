import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOLDED_KEY, INTERVALS, INTERVAL_KEY, MIN_MARK, REFRESH_MS, WINDOW_MS, agoLabel, axisTicks, bucketSpans, gridTicks, intervalOf, mergeSpans, readFolded, readInterval, spanBox, teamBusy, timelineTeams, trackX, writeFolded, writeInterval } from '../../web/src/dispatch/lib/timeline.ts';

const mk = (id: string, role: string, folder: string | null, startedAt: number, parent: string | null = null) => ({ id, role, folder, startedAt, parent });
const roles = [{ id: 'lead' }, { id: 'impl' }, { id: 'review' }];
const known = new Set(['web', 'server']);
const sessions = [
  mk('L2', 'lead', 'web', 50),
  mk('rv', 'review', 'web', 12, 'L1'),
  mk('i2', 'impl', 'web', 20, 'L1'),
  mk('L1', 'lead', 'web', 10),
  mk('i1', 'impl', 'web', 11, 'L1'),
  mk('x', 'tester', 'web', 13, 'i1'),
  mk('s', 'lead', 'server', 5),
  mk('orphan', 'impl', 'web', 30, 'gone'),
  mk('e', 'impl', null, 2),
];
const ids = (teams: ReturnType<typeof timelineTeams>) => teams.map(t => [t.lead.id, t.members.map(s => s.id)]);

test('timelineTeams groups a project by lead, members in role order then oldest first', () => {
  assert.deepEqual(ids(timelineTeams(sessions, roles, 'web', known)), [
    ['L1', ['i1', 'i2', 'rv', 'x']],
    ['orphan', []],
    ['L2', []],
  ]);
});

test('timelineTeams heads a team with a session whose parent is out of view, and keeps scopes apart', () => {
  assert.deepEqual(ids(timelineTeams(sessions, roles, 'server', known)), [['s', []]]);
  assert.deepEqual(ids(timelineTeams(sessions, roles, null, known)), [['e', []]]);
  assert.equal(timelineTeams(sessions, roles, undefined, known).length, 5);
});

test('timelineTeams shows nothing while 미분류 waits, and survives a parent loop', () => {
  assert.deepEqual(timelineTeams(sessions, roles, null, known, true), []);
  const loop = [mk('a', 'impl', 'web', 1, 'b'), mk('b', 'impl', 'web', 2, 'a')];
  const shown = timelineTeams(loop, roles, 'web', known).flatMap(t => [t.lead, ...t.members]).map(s => s.id).sort();
  assert.deepEqual(shown, ['a', 'b']);
});

test('teamBusy opens teams with someone working, waiting or stuck', () => {
  assert.equal(teamBusy(['resting', 'working']), true);
  assert.equal(teamBusy(['waiting']), true);
  assert.equal(teamBusy(['resting', 'done', 'failed']), false);
  assert.equal(teamBusy([]), false);
});

test('mergeSpans keeps the strongest state at each moment and joins neighbours', () => {
  const lead = { spans: [{ state: 'resting', from: 0, to: 100 }], fails: [] };
  const a = { spans: [{ state: 'working', from: 10, to: 30 }, { state: 'resting', from: 30, to: 100 }], fails: [40] };
  const b = { spans: [{ state: 'waiting', from: 20, to: 50 }, { state: 'failed', from: 50, to: 100 }], fails: [50, 40] };
  assert.deepEqual(mergeSpans([lead, a, b]), {
    spans: [
      { state: 'resting', from: 0, to: 10 },
      { state: 'working', from: 10, to: 30 },
      { state: 'waiting', from: 30, to: 50 },
      { state: 'failed', from: 50, to: 100 },
    ],
    fails: [40, 50],
  });
});

test('mergeSpans leaves gaps no member covers empty', () => {
  const a = { spans: [{ state: 'working', from: 0, to: 10 }], fails: [] };
  const b = { spans: [{ state: 'working', from: 20, to: 30 }], fails: [] };
  assert.deepEqual(mergeSpans([a, b]).spans, [{ state: 'working', from: 0, to: 10 }, { state: 'working', from: 20, to: 30 }]);
  assert.deepEqual(mergeSpans([]), { spans: [], fails: [] });
});

test('trackX snaps to whole pixels and clamps to the track (#936)', () => {
  const now = 7_200_000, win = 7_200_000;
  assert.equal(trackX(0, now, win, 601), 0);
  assert.equal(trackX(now, now, win, 601), 601);
  assert.equal(trackX(now / 2, now, win, 601), 301);
  assert.equal(trackX(-5, now, win, 601), 0);
  assert.equal(trackX(now + 5, now, win, 601), 601);
  for (const t of [1, 1234, 99_999, 3_333_333]) assert.ok(Number.isInteger(trackX(t, now, win, 333.7)));
});

test('spanBox gives whole-pixel boxes, neighbours meet, short work keeps the tick width (#936)', () => {
  const now = 7_200_000, win = 7_200_000, w = 517;
  const a = spanBox(0, 1_000_000, now, win, w);
  const b = spanBox(1_000_000, 2_500_000, now, win, w);
  assert.ok([a.left, a.width, b.left, b.width].every(Number.isInteger));
  assert.equal(a.left + a.width, b.left);
  assert.equal(spanBox(500, 600, now, win, w).width, MIN_MARK);
  const end = spanBox(now - 10, now, now, win, w);
  assert.equal(end.left + end.width, w);
});

test('axisTicks puts labels on the half hours at the tracks\' x, none crowding 지금 (#936)', () => {
  const min = 60_000;
  const now = Date.UTC(2026, 0, 1, 12, 40);
  const ticks = axisTicks(now, 120 * min, 600);
  assert.deepEqual(ticks.map(k => new Date(k.t).getUTCHours() * 60 + new Date(k.t).getUTCMinutes()), [660, 690, 720]);
  for (const k of ticks) assert.equal(k.x, trackX(k.t, now, 120 * min, 600));
  assert.ok(ticks.every(k => now - k.t >= 15 * min));
  assert.equal(axisTicks(Date.UTC(2026, 0, 1, 12, 10), 120 * min, 600).at(-1)!.t, Date.UTC(2026, 0, 1, 11, 30));
});

test('intervals: every pick shows the last 30 minutes, only the bucket and ticks change (#944)', () => {
  assert.equal(WINDOW_MS, 30 * 60_000);
  assert.deepEqual(INTERVALS.map(i => [i.id, i.bucketMs / 1000]), [['30s', 30], ['1m', 60], ['5m', 300]]);
  assert.deepEqual(INTERVALS.map(i => i.hint), ['최근 30분 · 30초 간격', '최근 30분 · 1분 간격', '최근 30분 · 5분 간격']);
  assert.ok(INTERVALS.every(i => !('windowMs' in i)));
  assert.equal(intervalOf(undefined).id, '5m');
  assert.equal(intervalOf('nope').id, '5m');
  assert.equal(intervalOf('30s').label, '30초');
});

test('agoLabel counts 최근 업데이트 in seconds, then minutes, refreshed every 5s (#944)', () => {
  assert.equal(REFRESH_MS, 5_000);
  assert.equal(agoLabel(0), '최근 업데이트 방금');
  assert.equal(agoLabel(-200), '최근 업데이트 방금');
  assert.equal(agoLabel(4_999), '최근 업데이트 방금');
  assert.equal(agoLabel(5_000), '최근 업데이트 5초 전');
  assert.equal(agoLabel(59_999), '최근 업데이트 59초 전');
  assert.equal(agoLabel(125_000), '최근 업데이트 2분 전');
});

test('readInterval/writeInterval remember the pick and survive blocked or broken storage (#936)', () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.equal(readInterval(store), '5m');
  writeInterval(store, '1m');
  assert.equal(mem.get(INTERVAL_KEY), '1m');
  assert.equal(readInterval(store), '1m');
  mem.set(INTERVAL_KEY, 'garbage');
  assert.equal(readInterval(store), '5m');
  const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(readInterval(blocked), '5m');
  assert.doesNotThrow(() => writeInterval(blocked, '30s'));
  assert.equal(readInterval(undefined), '5m');
  assert.doesNotThrow(() => writeInterval(undefined, '30s'));
});

test('readFolded/writeFolded remember the folded 타임라인 card and survive blocked storage', () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  assert.equal(readFolded(store), false);
  writeFolded(store, true);
  assert.equal(mem.get(FOLDED_KEY), '1');
  assert.equal(readFolded(store), true);
  writeFolded(store, false);
  assert.equal(mem.has(FOLDED_KEY), false);
  assert.equal(readFolded(store), false);
  const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => { throw new Error('SecurityError'); } };
  assert.equal(readFolded(blocked), false);
  assert.doesNotThrow(() => writeFolded(blocked, true));
  assert.equal(readFolded(undefined), false);
  assert.doesNotThrow(() => writeFolded(undefined, false));
});

test('bucketSpans draws each bucket in its strongest state on the wall-clock grid (#936)', () => {
  const s = 1000;
  const now = 600 * s; // window 5 minutes at 30 s buckets
  const row = { spans: [
    { state: 'resting', from: 300 * s, to: 410 * s },
    { state: 'working', from: 410 * s, to: 415 * s }, // 5 s of work fills its whole bucket
    { state: 'resting', from: 415 * s, to: 600 * s },
  ], fails: [100 * s, 500 * s] };
  const out = bucketSpans(row, now, 300 * s, 30 * s);
  assert.deepEqual(out.spans, [
    { state: 'resting', from: 300 * s, to: 390 * s },
    { state: 'working', from: 390 * s, to: 420 * s },
    { state: 'resting', from: 420 * s, to: 600 * s },
  ]);
  assert.deepEqual(out.fails, [500 * s]);
  for (const p of out.spans) assert.equal((p.from / (30 * s)) % 1, 0);
});

test('bucketSpans clips the off-grid window ends and leaves untouched buckets empty (#936)', () => {
  const s = 1000;
  const out = bucketSpans({ spans: [{ state: 'done', from: 205 * s, to: 215 * s }], fails: [] }, 245 * s, 60 * s, 30 * s);
  assert.deepEqual(out.spans, [{ state: 'done', from: 185 * s, to: 240 * s }]);
  const edge = bucketSpans({ spans: [{ state: 'working', from: 0, to: 245 * s }], fails: [] }, 245 * s, 60 * s, 30 * s);
  assert.deepEqual(edge.spans, [{ state: 'working', from: 185 * s, to: 245 * s }]);
});

test('every interval keeps whole-pixel ticks, labels and boxes on the same x (#936)', () => {
  const now = Date.UTC(2026, 0, 1, 12, 7, 13);
  for (const iv of INTERVALS) for (const w of [1188, 1187.4, 333]) {
    const grid = gridTicks(now, WINDOW_MS, w, iv.bucketMs);
    assert.ok(grid.every(Number.isInteger) && grid.every(x => x > 0 && x < w));
    const labels = axisTicks(now, WINDOW_MS, w, iv.labelMs);
    assert.ok(labels.length >= 1);
    for (const l of labels) assert.ok(grid.includes(l.x), `${iv.id}: label at ${l.x} sits on a tick`);
  }
});
