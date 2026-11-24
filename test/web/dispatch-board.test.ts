import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DONE_LIMIT, attentionTaskIds, etaCardText, etaLine, groupByStage, span, stageSpans, taskWarn as warnOf, visibleTasks } from '../../web/src/dispatch/lib/board.ts';
import type { BoardTask } from '../../web/src/dispatch/types.ts';

const MIN = 60_000;
const mk = (id: string, stage: BoardTask['stage'], stageAt: number, extra: Partial<BoardTask> = {}): BoardTask =>
  ({ id, lead: 'l', title: id, stage, owner: null, createdAt: 0, stageAt, updatedAt: 0, etaAt: null, note: '', ...extra });

test('groupByStage fills every column and puts the longest-standing first', () => {
  const g = groupByStage([mk('b', 'impl', 20), mk('a', 'impl', 10), mk('c', 'blocked', 5)]);
  assert.deepEqual(g.impl.map(t => t.id), ['a', 'b']);
  assert.deepEqual(g.blocked.map(t => t.id), ['c']);
  assert.deepEqual(g.done, []);
  assert.deepEqual(Object.keys(g), ['plan', 'impl', 'review', 'test', 'merge', 'done', 'blocked']);
});

test('stageSpans sums revisited stages and runs the current one to now', () => {
  const t = mk('x', 'test', 30 * MIN, { stages: [{ stage: 'plan', at: 0 }, { stage: 'impl', at: 10 * MIN }, { stage: 'review', at: 20 * MIN }, { stage: 'impl', at: 25 * MIN }, { stage: 'test', at: 30 * MIN }] });
  assert.deepEqual(stageSpans(t, 42 * MIN), [
    { stage: 'plan', ms: 10 * MIN }, { stage: 'impl', ms: 15 * MIN }, { stage: 'review', ms: 5 * MIN }, { stage: 'test', ms: 12 * MIN },
  ]);
});

test('stageSpans seeds a task without history from its stage time', () => {
  assert.deepEqual(stageSpans(mk('x', 'review', 5 * MIN), 8 * MIN), [{ stage: 'review', ms: 3 * MIN }]);
});

test('span formats minutes, hours and days', () => {
  assert.equal(span(30_000), '방금');
  assert.equal(span(12 * MIN), '12분');
  assert.equal(span(72 * MIN), '1시간 12분');
  assert.equal(span(49 * 60 * MIN), '2일');
});

test('etaLine: minutes left, almost, late, none, done', () => {
  assert.deepEqual(etaLine({ stage: 'impl', etaAt: 100 * MIN }, 90 * MIN), { text: '10분 남음', late: false, estimated: false });
  assert.deepEqual(etaLine({ stage: 'impl', etaAt: 100 * MIN + 20_000 }, 100 * MIN), { text: '곧 끝나요', late: false, estimated: false });
  assert.deepEqual(etaLine({ stage: 'impl', etaAt: 100 * MIN }, 115 * MIN), { text: '15분 지남', late: true, estimated: false });
  assert.equal(etaLine({ stage: 'impl', etaAt: null }, 0), null);
  assert.equal(etaLine({ stage: 'done', etaAt: 5 }, 0), null);
});

test('etaLine: a server estimate says so; a passed one reads N분 지남 (#1028)', () => {
  assert.deepEqual(etaLine({ stage: 'review', etaAt: 100 * MIN, etaEstimated: true }, 88 * MIN), { text: '약 12분 남음(예상)', late: false, estimated: true });
  assert.deepEqual(etaLine({ stage: 'review', etaAt: 100 * MIN, etaEstimated: true }, 114 * MIN), { text: '14분 지남', late: true, estimated: true });
});

test('stageProgress: step on 계획 → 구현 → 리뷰 → 테스트 → 머지 (#1028)', async () => {
  const { stageProgress } = await import('../../web/src/dispatch/lib/board.ts');
  assert.equal(stageProgress('review')?.text, '리뷰 · 3/5');
  assert.equal(stageProgress('plan')?.text, '계획 · 1/5');
  assert.equal(stageProgress('merge')?.text, '머지 · 5/5');
  assert.deepEqual([stageProgress('test')?.step, stageProgress('test')?.total], [4, 5]);
  assert.equal(stageProgress('done'), null);
  assert.equal(stageProgress('blocked'), null);
});

test('완료 column lists the newest first and caps at DONE_LIMIT with a hidden count', () => {
  const done = Array.from({ length: DONE_LIMIT + 3 }, (_, i) => mk(`d${i}`, 'done', i));
  const g = groupByStage(done);
  assert.equal(g.done[0]!.id, `d${DONE_LIMIT + 2}`);
  const v = visibleTasks('done', g.done, false);
  assert.equal(v.shown.length, DONE_LIMIT);
  assert.equal(v.more, 3);
  assert.equal(visibleTasks('done', g.done, true).more, 0);
  assert.equal(visibleTasks('done', g.done, true).shown.length, DONE_LIMIT + 3);
  const impl = groupByStage(Array.from({ length: 15 }, (_, i) => mk(`i${i}`, 'impl', i))).impl;
  assert.equal(visibleTasks('impl', impl, false).shown.length, 15);
});

test('taskWarn: only blocked, stuck or late tasks carry a warning (#919)', async () => {
  const { taskWarn } = await import('../../web/src/dispatch/lib/board.ts');
  const now = 10_000_000;
  assert.equal(taskWarn({ stage: 'impl', note: null, stuck: null, etaAt: now + 600_000 } as never, now), null);
  assert.equal(taskWarn({ stage: 'impl', note: null, stuck: null, etaAt: null } as never, now), null);
  assert.deepEqual(taskWarn({ stage: 'blocked', note: '리뷰 대기', stuck: null, etaAt: null } as never, now), { text: '리뷰 대기', tone: 'bad' });
  assert.equal(taskWarn({ stage: 'blocked', note: '', stuck: null, etaAt: null } as never, now)?.text, '막혔어요');
  assert.deepEqual(taskWarn({ stage: 'impl', note: null, stuck: { label: '예상 20분의 1.5배' }, etaAt: null } as never, now), { text: '예상 20분의 1.5배', tone: 'warn' });
  assert.equal(taskWarn({ stage: 'impl', note: null, stuck: null, etaAt: now - 10 * 60_000 } as never, now)?.tone, 'warn');
});

test('attentionTaskIds: task rows (late, mismatch, merge) hide that task from the board list; session and limit rows do not', () => {
  const ids = attentionTaskIds([{ key: 't:a' }, { key: 'm:b' }, { key: 's:c' }, { key: 'l:five' }]);
  assert.deepEqual([...ids].sort(), ['a', 'b']);
});

test('etaLine: an estimated ETA says so; a passed one reads N분 지남 (#1028)', () => {
  assert.deepEqual(etaLine({ stage: 'review', etaAt: 100 * MIN, etaEstimated: true }, 88 * MIN), { text: '약 12분 남음(예상)', late: false, estimated: true });
  assert.deepEqual(etaLine({ stage: 'review', etaAt: 100 * MIN, etaEstimated: true }, 106 * MIN), { text: '6분 지남', late: true, estimated: true });
  assert.deepEqual(warnOf({ stage: 'impl', note: '', stuck: null, etaAt: 100 * MIN } as never, 110 * MIN), { text: '예상보다 10분 지남', tone: 'warn' });
});

test('etaCardText: the card says 예상 once for estimated, recorded and passed ETAs (#1028)', () => {
  const text = (etaAt: number, now: number, etaEstimated?: boolean) => etaCardText(etaLine({ stage: 'impl', etaAt, etaEstimated }, now)!);
  assert.equal(text(100 * MIN, 88 * MIN, true), '약 12분 남음(예상)');
  assert.equal(text(100 * MIN, 88 * MIN), '12분 남음');
  assert.equal(text(100 * MIN, 106 * MIN, true), '예상보다 6분 지남');
  for (const s of [text(100 * MIN, 88 * MIN, true), text(100 * MIN, 106 * MIN)]) assert.equal(s.split('예상').length - 1, 1);
});
