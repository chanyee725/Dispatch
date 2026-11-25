import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearChats } from '../../web/src/shell/chatHistory.ts';

test('settings clear sends an authenticated DELETE and returns the count', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ removed: 2 }));
  assert.equal(await clearChats(), 2);
  assert.deepEqual(fetch.mock.calls[0]?.arguments, ['/api/chats', {
    method: 'DELETE',
    headers: { 'x-drawing': '1', 'x-drawing-client': 'app' },
  }]);
});

test('settings clear reports a failed request', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'failed' }, { status: 500 }));
  await assert.rejects(clearChats(), { message: 'failed', status: 500 });
});
