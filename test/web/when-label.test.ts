import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateTimeLabel, whenLabel } from '../../web/src/lib/when.ts';

const now = new Date(2026, 10, 20, 12, 0).getTime();
const MIN = 60_000;

test('whenLabel: relative inside 7 days', () => {
  assert.equal(whenLabel(now - 20_000, now), '방금');
  assert.equal(whenLabel(now + 5 * MIN, now), '방금');
  assert.equal(whenLabel(now - 5 * MIN, now), '5분 전');
  assert.equal(whenLabel(now - 3 * 60 * MIN, now), '3시간 전');
  assert.equal(whenLabel(now - 6 * 24 * 60 * MIN, now), '6일 전');
});

test('whenLabel: a date from 7 days on, with the year only when it differs', () => {
  assert.equal(whenLabel(new Date(2026, 10, 12, 9).getTime(), now), '11월 12일');
  assert.equal(whenLabel(new Date(2025, 10, 12, 9).getTime(), now), '2025년 11월 12일');
});

test('dateTimeLabel is the full Korean date and time used by version and trash lists', () => {
  const t = new Date(2026, 10, 21, 15, 5).getTime();
  assert.equal(dateTimeLabel(t), new Date(t).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }));
  assert.match(dateTimeLabel(t), /2026/);
});
