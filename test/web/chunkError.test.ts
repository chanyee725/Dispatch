import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_MESSAGE, CRASH_MESSAGE, isChunkLoadError, noticeFor } from '../../web/src/chunkError.ts';

test('failed dynamic imports are recognised in each browser wording', () => {
  for (const m of [
    'Failed to fetch dynamically imported module: http://x/assets/DocPane-abc.js', // Chromium
    'error loading dynamically imported module: http://x/a.js', // Firefox
    'Importing a module script failed.', // Safari
    'Loading chunk 7 failed.',
    'Unable to preload CSS for /assets/DocPane-abc.css', // Vite, one CSS chunk
  ])
    assert.equal(isChunkLoadError(new TypeError(m)), true, m);
  const named = new Error('x');
  named.name = 'ChunkLoadError';
  assert.equal(isChunkLoadError(named), true);
});

test('other errors are not chunk errors and get the generic notice', () => {
  for (const e of [new Error('boom'), new TypeError('x is undefined'), null, undefined, 'str', {}]) assert.equal(isChunkLoadError(e), false);
  assert.equal(noticeFor(new TypeError('Failed to fetch dynamically imported module: u')), CHUNK_MESSAGE);
  assert.equal(noticeFor(new Error('boom')), CRASH_MESSAGE);
  assert.equal(CHUNK_MESSAGE, '새 버전이 있어요. 새로고침해 주세요');
});
