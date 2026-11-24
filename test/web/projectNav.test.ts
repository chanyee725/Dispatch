import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardHash, isChatHash, legacyBoardHash, parseBoardHash, percent, shellKey } from '../../web/src/projectNav.ts';
const key = (code: string, more: Record<string, unknown> = {}) =>
  shellKey({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false, target: null, ...more });
const inside = (match: boolean) => ({ closest: () => (match ? {} : null) }) as unknown as EventTarget;

test('shellKey: S outside fields, editors and dialogs only', () => {
  assert.equal(key('KeyS'), 'board');
  for (const c of ['KeyA', 'KeyR', 'KeyB', 'KeyN', 'Comma', 'KeyX']) assert.equal(key(c), null, c);
  for (const m of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing', 'repeat', 'defaultPrevented']) assert.equal(key('KeyS', { [m]: true }), null, m);
  assert.equal(key('KeyS', { target: inside(true) }), null);
  assert.equal(key('KeyS', { target: inside(false) }), 'board');
});

test('percent clamps and rounds', () => {
  assert.equal(percent(0.424), 42);
  assert.equal(percent(1.4), 100);
  assert.equal(percent(null), null);
  assert.equal(percent(Number.NaN), null);
});

test('modelStatus: text next to every dot, yellow from 60%, red from 85%', async () => {
  const { modelStatus } = await import('../../web/src/projectNav.ts');
  const m = { id: 'claude', name: 'Claude', installed: true, connected: true, pct: 42, reached: false };
  assert.deepEqual(modelStatus(m, true), { text: '42%', long: '연결됨, 5시간 한도 42% 사용', tone: 'ok' });
  // Green, then yellow from 60%, red from 85%; a reached limit is red.
  assert.equal(modelStatus({ ...m, pct: 59 }, true).tone, 'ok');
  assert.equal(modelStatus({ ...m, pct: 60 }, true).tone, 'warn');
  assert.equal(modelStatus({ ...m, pct: 84 }, true).tone, 'warn');
  assert.equal(modelStatus({ ...m, pct: 85 }, true).tone, 'bad');
  assert.equal(modelStatus({ ...m, reached: true }, true).tone, 'bad');
  assert.deepEqual(modelStatus({ ...m, pct: null }, true), { text: '연결됨', long: '연결됨', tone: 'ok' });
  assert.equal(modelStatus({ ...m, reached: true }, true).text, '한도 도달');
  assert.deepEqual(modelStatus({ ...m, connected: false }, true), { text: '연결 안 됨', long: '연결 안 됨', tone: 'off' });
  assert.equal(modelStatus(m, false).text, '연결 안 됨');
  assert.deepEqual(modelStatus({ ...m, connected: false, busy: true }, true), { text: '연결 중', long: '연결하는 중', tone: 'off' });
});

test('board hash: tabs, scope and the one-off extras read back', () => {
  assert.deepEqual(parseBoardHash('#board'), { kind: 'board', tab: 'sessions' });
  assert.deepEqual(parseBoardHash('#board=usage'), { kind: 'board', tab: 'usage' });
  assert.deepEqual(parseBoardHash('#board=timeline&folder=a%20b'), { kind: 'board', tab: 'timeline', folder: 'a b' });
  assert.deepEqual(parseBoardHash('#board&folder='), { kind: 'board', tab: 'sessions', folder: null });
  assert.deepEqual(parseBoardHash('#board=tv'), { kind: 'board', tab: 'sessions', extra: 'tv' });
  assert.equal(parseBoardHash('#file=a.dpx.json'), null);
  assert.equal(parseBoardHash('#boards'), null);
  assert.equal(parseBoardHash(''), null);
  assert.ok(isChatHash('#chat'));
  assert.ok(!isChatHash('#chats') && !isChatHash('#board'));
  for (const h of ['#board', '#board=usage', '#board=timeline&folder=a%20b', '#board&folder=', '#board=settings']) assert.equal(boardHash(parseBoardHash(h)!), h);
});

test('legacy /dispatch hashes map to the board address', () => {
  assert.equal(legacyBoardHash(''), '#board');
  assert.equal(legacyBoardHash('#usage'), '#board=usage');
  assert.equal(legacyBoardHash('#timeline&folder=docs'), '#board=timeline&folder=docs');
  assert.equal(legacyBoardHash('#folder=x'), '#board&folder=x');
  assert.equal(legacyBoardHash('#folder='), '#board&folder=');
  assert.equal(legacyBoardHash('#tv'), '#board=tv');
  assert.equal(legacyBoardHash('#settings'), '#board=settings');
  assert.equal(legacyBoardHash('#nonsense'), '#board');
  assert.equal(legacyBoardHash('#board=usage'), '#board=usage');
});
