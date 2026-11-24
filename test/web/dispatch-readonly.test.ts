import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canRun, READ_ONLY_NOTICE, RUNNABLE_PROVIDERS } from '../../web/src/dispatch/lib/runnable.ts';

test('Claude, Codex and Gemini sessions can run; an unknown provider is read-only', () => {
  assert.equal(canRun({ provider: 'claude' }), true);
  assert.equal(canRun({ provider: 'openai' }), true);
  assert.equal(canRun({ provider: 'gemini' }), true);
  assert.equal(canRun({ provider: 'other' }), false);
});

test('the runnable list matches the server hub PROVIDERS', () => {
  const src = readFileSync(new URL('../../server/dispatch/hub-util.js', import.meta.url), 'utf8');
  const m = src.match(/export const PROVIDERS = (\[[^\]]*\])/);
  assert.ok(m);
  assert.deepEqual(JSON.parse(m[1]), [...RUNNABLE_PROVIDERS]);
});

test('the read-only notice is short 해요체', () => {
  // Every sentence ends in 요. (not just one), and no 합니다/습니다 form slips in.
  assert.match(READ_ONLY_NOTICE, /^(?:[^.]+요\.)(?: [^.]+요\.)*$/);
  assert.doesNotMatch(READ_ONLY_NOTICE, /니다/);
  assert.ok(READ_ONLY_NOTICE.length < 60);
});
