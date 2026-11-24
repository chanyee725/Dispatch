// 설정 > 모드별 모델 (#748): shown cells, the PUT body (cells, reset as nulls, hints), dirty note and fallback notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirtyNote, fallbackNote, hintKey, hintsPatch, modePatch, saveBody, shownCell, type ModeProfiles } from '../../web/src/settings/sections/modeProfiles.ts';

const SONNET = { provider: 'claude', model: 'claude-sonnet-5-5', effort: null, perm: 'auto' };
const OPUS = { provider: 'claude', model: 'claude-opus-5-5', effort: null, perm: 'auto' };
const p = (): ModeProfiles => ({
  modes: [
    { id: 'plan', name: '계획/설계' },
    { id: 'impl', name: '구현' },
  ],
  roles: [
    { id: 'lead', name: '관리자' },
    { id: 'review', name: '리뷰어' },
  ],
  defaults: {
    plan: { lead: { ...OPUS, fallbacks: [], cross: false }, review: { provider: 'openai', model: null, effort: null, perm: 'auto', cross: true } },
    impl: { lead: SONNET, review: { provider: 'openai', model: null, effort: null, perm: 'auto' } },
  },
  hints: { 'claude-opus-5-5': '구현', openai: '서치·자료 수집', 'claude-sonnet-5-5': '내 힌트' },
  stored: { cells: { impl: { lead: OPUS } }, hints: { 'claude-sonnet-5-5': '내 힌트' } },
  grid: {},
});

test('a cell shows the edit, else the stored cell, else the built-in default', () => {
  const d = p();
  assert.deepEqual(shownCell(d, {}, new Set(), 'impl', 'lead'), OPUS);
  assert.deepEqual(shownCell(d, {}, new Set(), 'plan', 'lead'), OPUS);
  assert.equal(shownCell(d, {}, new Set(), 'plan', 'review').model, null, 'Codex default before its list is known');
  assert.deepEqual(shownCell(d, {}, new Set(['impl']), 'impl', 'lead'), SONNET, 'a reset mode shows the defaults');
  assert.deepEqual(shownCell(d, { impl: { lead: { ...SONNET, effort: 'low' } } }, new Set(), 'impl', 'lead'), { ...SONNET, effort: 'low' });
});

test('only changed cells are sent; a pick equal to the default and a reset send null', () => {
  const d = p();
  assert.equal(saveBody(d, {}, new Set(), {}), null);
  assert.equal(modePatch(d, { impl: { lead: OPUS } }, new Set(), 'impl'), null, 'same as stored');
  assert.deepEqual(modePatch(d, { impl: { lead: SONNET } }, new Set(), 'impl'), { lead: null }, 'back to the default');
  assert.deepEqual(saveBody(d, {}, new Set(['impl']), {}), { cells: { impl: { lead: null } } });
  assert.deepEqual(saveBody(d, { plan: { lead: SONNET } }, new Set(), {}), { cells: { plan: { lead: SONNET } } });
  assert.equal(saveBody(d, {}, new Set(['plan']), {}), null, 'resetting a mode with nothing stored changes nothing');
});

test('hints are per model (Claude) or per provider, cleared ones go back to the built-in text', () => {
  assert.equal(hintKey('claude', 'claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(hintKey('openai', 'gpt-x'), 'openai');
  const d = p();
  assert.equal(hintsPatch(d, { 'claude-opus-5-5': ' 구현 ' }), null, 'unchanged after trimming');
  assert.deepEqual(hintsPatch(d, { 'claude-opus-5-5': '큰 기능' }), { 'claude-opus-5-5': '큰 기능' });
  assert.deepEqual(hintsPatch(d, { 'claude-sonnet-5-5': '' }), { 'claude-sonnet-5-5': null });
  assert.equal(hintsPatch(d, { openai: '' }), null, 'clearing a built-in hint stores nothing');
});

test('hint edits for a model no cell uses any more are not sent', () => {
  const d = p();
  // impl/lead shows Opus (stored); plan/lead shows Opus (default). Edit Opus's hint, then swap Opus out of both cells.
  const hint = { 'claude-opus-5-5': '큰 기능' };
  assert.deepEqual(saveBody(d, {}, new Set(), hint), { hints: hint }, 'still used: sent');
  const swapped = { plan: { lead: SONNET }, impl: { lead: { ...SONNET, effort: 'low' } } };
  assert.deepEqual(saveBody(d, swapped, new Set(), hint), {
    cells: { plan: { lead: SONNET }, impl: { lead: { ...SONNET, effort: 'low' } } },
  });
  assert.deepEqual(saveBody(d, swapped, new Set(), { ...hint, openai: '코덱스' }).hints, { openai: '코덱스' }, 'used models keep their edits');
});

test('the status names another mode with unsaved edits, not the open one', () => {
  const d = p();
  const edits = { plan: { lead: SONNET } };
  assert.equal(dirtyNote(d, edits, new Set(), 'impl'), '계획/설계 모드에 저장하지 않은 변경이 있어요.');
  assert.equal(dirtyNote(d, edits, new Set(), 'plan'), '');
});

test('fallback notes keep the server reason and swap the model id for its label', () => {
  const label = (id: string) => (id === 'claude-opus-5-5' ? 'Opus 5.5' : undefined);
  assert.deepEqual(fallbackNote('대신 claude-opus-5-5: OpenAI Codex 연결 안 됨', label), { model: 'Opus 5.5', text: 'OpenAI Codex 연결 안 됨', info: false });
  assert.deepEqual(fallbackNote('대신 x-1: a, b', label), { model: 'x-1', text: 'a, b', info: false });
  assert.equal(fallbackNote('구현자와 다른 모델이 없어 같은 모델을 써요', label)?.info, true);
  assert.equal(fallbackNote(null, label), null);
});
