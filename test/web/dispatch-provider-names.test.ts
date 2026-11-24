import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerName } from '../../web/src/dispatch/lib/format.ts';

test('provider display names keep old Codex/Gemini sessions readable', () => {
  assert.equal(providerName('claude'), 'Claude');
  assert.equal(providerName('openai'), 'GPT');
  assert.equal(providerName('gemini'), 'Gemini');
});

test('an unknown provider id falls back to the id', () => {
  assert.equal(providerName('other'), 'other');
});
