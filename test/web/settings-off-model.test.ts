// Settings with Dispatch off (#620): one line saying why session settings cannot change and what to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offReason } from '../../web/src/settings/model.ts';

test('offReason says why and what to do for the known reasons', () => {
  assert.match(offReason({ reason: 'not-git', message: 'x' }), /git 저장소 밖.*다시 열면 바꿀 수 있어요\.$/);
  assert.match(offReason({ reason: 'no-workspace' }), /작업 공간이 없어서.*바꿀 수 있어요\.$/);
  assert.match(offReason({ reason: 'unsafe' }), /심볼릭 링크.*다시 시작해 주세요\.$/);
});

test('offReason uses the server message for other reasons, with a fallback', () => {
  assert.equal(offReason({ reason: 'standalone', message: ' 그 서버를 멈춰 주세요. ' }), '그 서버를 멈춰 주세요.');
  assert.match(offReason({ enabled: false } as { reason?: string }), /실행 기능이 꺼져 있어요/);
  assert.match(offReason(null), /실행 기능이 꺼져 있어요/);
});
