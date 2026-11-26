import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSize, writeSize } from '../../web/src/lib/resizeSize.ts';
import {
  DEFAULT_HEIGHT, HANDLE_HEIGHT, SESSIONS_MIN, STORAGE_KEY, TIMELINE_MIN,
  heightForKey, maxSessionHeight, preferredHeight,
} from '../../web/src/dispatch/lib/sessionTimelineSize.ts';

test('the split reserves the timeline and handle space even when the board is short', () => {
  assert.equal(maxSessionHeight(600), 600 - TIMELINE_MIN - HANDLE_HEIGHT);
  assert.equal(maxSessionHeight(220), SESSIONS_MIN);
});

test('arrow keys move the divider within its bounds, and Home and End reach both limits', () => {
  assert.equal(heightForKey(320, 400, 'ArrowUp'), 304);
  assert.equal(heightForKey(320, 400, 'ArrowDown', true), 384);
  assert.equal(heightForKey(150, 400, 'ArrowUp', true), SESSIONS_MIN);
  assert.equal(heightForKey(390, 400, 'ArrowDown'), 400);
  assert.equal(heightForKey(320, 400, 'Home'), SESSIONS_MIN);
  assert.equal(heightForKey(320, 400, 'End'), 400);
  assert.equal(heightForKey(320, 400, 'ArrowRight'), null);
});

test('storage keeps only the preferred height so a short viewport cannot shrink the saved size', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const read = () => readSize(STORAGE_KEY, DEFAULT_HEIGHT, preferredHeight, storage);
  assert.equal(read(), DEFAULT_HEIGHT);
  writeSize(STORAGE_KEY, 420, storage);
  assert.equal(Math.min(read(), maxSessionHeight(420)), 260);
  assert.equal(read(), 420);
  writeSize(STORAGE_KEY, 20, storage);
  assert.equal(read(), SESSIONS_MIN);
  values.set(STORAGE_KEY, 'NaN');
  assert.equal(read(), DEFAULT_HEIGHT);
});
