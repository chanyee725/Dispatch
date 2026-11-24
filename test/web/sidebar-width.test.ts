import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampWidth, keyWidth, readWidth, writeWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_WIDTH_KEY } from '../../web/src/lib/sidebarWidth.ts';

const memory = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const throwing = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

test('clampWidth keeps 200–480, rounds, and falls back on non-numbers', () => {
  assert.equal(clampWidth(100), SIDEBAR_MIN);
  assert.equal(clampWidth(900), SIDEBAR_MAX);
  assert.equal(clampWidth(300.6), 301);
  assert.equal(clampWidth(Number.NaN), SIDEBAR_DEFAULT);
  assert.equal(clampWidth(Infinity), SIDEBAR_DEFAULT);
});

test('readWidth: default when nothing, junk or blocked storage; clamps a saved value', () => {
  const s = memory();
  assert.equal(readWidth(s), 264);
  s.m.set(SIDEBAR_WIDTH_KEY, 'wide');
  assert.equal(readWidth(s), 264);
  s.m.set(SIDEBAR_WIDTH_KEY, '');
  assert.equal(readWidth(s), 264);
  s.m.set(SIDEBAR_WIDTH_KEY, '9999');
  assert.equal(readWidth(s), 480);
  s.m.set(SIDEBAR_WIDTH_KEY, '320');
  assert.equal(readWidth(s), 320);
  assert.equal(readWidth(throwing), 264);
  assert.equal(readWidth(null), 264);
});

test('writeWidth saves the clamped width and ignores a throwing storage', () => {
  const s = memory();
  writeWidth(1000, s);
  assert.equal(s.m.get(SIDEBAR_WIDTH_KEY), '480');
  assert.doesNotThrow(() => writeWidth(300, throwing));
});

test('keyWidth: ←/→ step 16 (Shift 64), Home resets, other keys are ignored', () => {
  assert.equal(keyWidth(264, 'ArrowRight'), 280);
  assert.equal(keyWidth(264, 'ArrowLeft'), 248);
  assert.equal(keyWidth(264, 'ArrowRight', true), 328);
  assert.equal(keyWidth(210, 'ArrowLeft'), 200);
  assert.equal(keyWidth(470, 'ArrowRight'), 480);
  assert.equal(keyWidth(400, 'Home'), 264);
  assert.equal(keyWidth(400, 'Enter'), null);
});
