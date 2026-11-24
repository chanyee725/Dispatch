import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastValue } from '../../web/src/lib/lastValue.ts';

test('lastValue: null before a read, then the last value; a failure keeps the last value (#705)', () => {
  const k = lastValue<number[]>();
  assert.equal(k.get(), null);
  assert.equal(k.put('failed'), 'failed');
  assert.equal(k.get(), 'failed');
  assert.deepEqual(k.put([1]), [1]);
  assert.deepEqual(k.put('failed'), [1]);
  assert.deepEqual(k.get(), [1]);
  assert.deepEqual(k.put([2]), [2]);
  // Each store is separate.
  assert.equal(lastValue<number>().get(), null);
});
