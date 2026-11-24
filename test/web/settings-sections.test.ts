// 설정 modal sections (#624): 관리자와 팀, 작업 폴더 and 멈춤 감지 each check and send only their own fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resyncTeamForm, settingsLoad, teamForm, teamValues } from '../../web/src/settings/model.ts';
import { resetSection, sectionDirty, sectionFields, sectionSave } from '../../web/src/settings/sections/sectionForm.ts';
import { TEAM_DEFAULTS } from '../../server/dispatch/settings.js';

const saved = teamValues({}, [{ id: 'lead', model: 'claude-sonnet-5-5' }]);

test('each section shows its own fields', () => {
  const ids = (s: 'team' | 'folders' | 'stuck') => {
    const f = sectionFields(s);
    return [...f.numbers.map((n) => n.id), ...f.toggles.map((t) => t.id)];
  };
  assert.deepEqual(ids('team'), ['rotateLead', 'rotateOthers', 'maxChildren', 'autoRemoveGraceSec', 'autoRemoveDone', 'autoRotateLong']);
  assert.deepEqual(ids('folders'), ['shareDeps', 'dropWorktrees']);
  assert.deepEqual(ids('stuck'), ['stuckFails', 'stuckSilentMinutes', 'stuckMismatchMinutes', 'stuckEtaRatio']);
});

test('section defaults match the server defaults', () => {
  const server = TEAM_DEFAULTS() as Record<string, unknown>;
  for (const s of ['team', 'folders', 'stuck'] as const) {
    const f = sectionFields(s);
    for (const n of f.numbers) assert.equal(n.def, server[n.id], n.id);
    for (const t of f.toggles) assert.equal(t.def, server[t.id], t.id);
  }
});

test('a section sends only its changed fields, never another section edit', () => {
  const form = teamForm(saved);
  form.texts.rotateLead = '7';
  form.texts.stuckFails = '9';
  form.toggles.shareDeps = false;
  const r = sectionSave(saved, form, 'team');
  assert.equal(r.kind, 'save');
  if (r.kind === 'save') {
    assert.deepEqual(r.patch, { rotateLead: 7 });
    assert.equal(r.next.stuckFails, saved.stuckFails);
    assert.equal(r.next.shareDeps, true);
  }
  const f = sectionSave(saved, form, 'folders');
  assert.deepEqual(f.kind === 'save' && f.patch, { shareDeps: false });
});

test('관리자와 팀 saves auto-remove: the switch and a grace of 3~3600 s (#640)', () => {
  assert.equal(saved.autoRemoveDone, true);
  assert.equal(saved.autoRemoveGraceSec, 120);
  const form = teamForm(saved);
  form.toggles.autoRemoveDone = false;
  form.texts.autoRemoveGraceSec = '45';
  const r = sectionSave(saved, form, 'team');
  assert.deepEqual(r.kind === 'save' && r.patch, { autoRemoveGraceSec: 45, autoRemoveDone: false });
  for (const bad of ['2', '3601', '']) {
    form.texts.autoRemoveGraceSec = bad;
    const b = sectionSave(saved, form, 'team');
    assert.equal(b.kind, 'invalid', bad);
    if (b.kind === 'invalid') {
      assert.equal(b.first, 'autoRemoveGraceSec');
      assert.match(b.message, /3~3600 사이 숫자를 넣어 주세요/);
    }
  }
  form.texts.autoRemoveGraceSec = '3600';
  assert.equal(sectionSave(saved, form, 'team').kind, 'save');
  const reset = resetSection(form, 'team');
  assert.equal(reset.texts.autoRemoveGraceSec, '120');
  assert.equal(reset.toggles.autoRemoveDone, true);
});

test('an untouched section has nothing to save', () => {
  const form = teamForm(saved);
  form.texts.rotateLead = '7';
  assert.equal(sectionSave(saved, form, 'stuck').kind, 'unchanged');
});

test('a bad number in the section is reported in Korean, with the field to focus', () => {
  const form = teamForm(saved);
  form.texts.stuckSilentMinutes = '999';
  form.texts.rotateLead = 'x'; // another section: not checked here
  const r = sectionSave(saved, form, 'stuck');
  assert.equal(r.kind, 'invalid');
  if (r.kind === 'invalid') {
    assert.equal(r.first, 'stuckSilentMinutes');
    assert.deepEqual(Object.keys(r.errors), ['stuckSilentMinutes']);
    assert.match(r.message, /출력 없이 도는 시간: 0~240 사이 숫자를 넣어 주세요/);
  }
});

test('the ETA ratio takes 0 (off) or 1~10 with one decimal place', () => {
  const form = teamForm(saved);
  form.texts.stuckEtaRatio = '0';
  const off = sectionSave(saved, form, 'stuck');
  assert.deepEqual(off.kind === 'save' && off.patch, { stuckEtaRatio: 0 });
  form.texts.stuckEtaRatio = '2.25';
  const two = sectionSave(saved, form, 'stuck');
  assert.deepEqual(two.kind === 'save' && two.patch, { stuckEtaRatio: 2.3 });
  form.texts.stuckEtaRatio = '0.5';
  const bad = sectionSave(saved, form, 'stuck');
  assert.equal(bad.kind, 'invalid');
  if (bad.kind === 'invalid') assert.match(bad.message, /0 또는 1~10 사이/);
});

test('기본값으로 resets only that section', () => {
  const form = teamForm(teamValues({ rotateLead: 2, maxChildren: 3, shareDeps: false, stuckFails: 7 }, []));
  const r = resetSection(form, 'team');
  assert.equal(r.texts.rotateLead, '5');
  assert.equal(r.texts.maxChildren, '8');
  assert.equal(r.texts.stuckFails, '7');
  assert.equal(r.toggles.shareDeps, false);
  const f = resetSection(form, 'folders');
  assert.equal(f.toggles.shareDeps, true);
  assert.equal(f.texts.rotateLead, '2');
});

test('sectionDirty sees only this section\'s unsaved input, valid or not (#638)', () => {
  const form = teamForm(saved);
  assert.equal(sectionDirty(saved, form, 'team'), false);
  const edited = { ...form, texts: { ...form.texts, maxChildren: '0' } };
  assert.equal(sectionDirty(saved, edited, 'team'), true, 'an invalid value is still unsaved input');
  assert.equal(sectionDirty(saved, edited, 'stuck'), false, 'another section\'s edit does not count');
  const toggled = { ...form, toggles: { ...form.toggles, dropWorktrees: !form.toggles.dropWorktrees } };
  assert.equal(sectionDirty(saved, toggled, 'folders'), true);
  const back = { ...form, texts: { ...form.texts, maxChildren: ` ${saved.maxChildren} ` } };
  assert.equal(sectionDirty(saved, back, 'team'), false, 'typing the saved value back is not an edit');
});

test('auto-remove off leaves the grace period as it is, like standalone Dispatch: still sent and still unsaved input (#638)', () => {
  const form = teamForm({ ...saved, autoRemoveDone: false });
  const off = { ...saved, autoRemoveDone: false };
  assert.equal(sectionDirty(off, form, 'team'), false);
  form.texts.autoRemoveGraceSec = '300';
  assert.equal(sectionDirty(off, form, 'team'), true);
  const r = sectionSave(off, form, 'team');
  assert.deepEqual(r.kind === 'save' && r.patch, { autoRemoveGraceSec: 300 });
});

test('sectionDirty reads numbers, not their spelling: 08 is the saved 8, blank is an edit (#644)', () => {
  const form = teamForm(saved);
  const as = (t: string) => ({ ...form, texts: { ...form.texts, maxChildren: t } });
  assert.equal(sectionDirty(saved, as(`0${saved.maxChildren}`), 'team'), false);
  assert.equal(sectionDirty(saved, as(`${saved.maxChildren}.0`), 'team'), false);
  assert.equal(sectionDirty(saved, as(''), 'team'), true);
  assert.equal(sectionDirty(saved, as(`${saved.maxChildren + 1}`), 'team'), true);
});

test('unsaved input stays unsaved while the session stream drops and reconnects (#644)', () => {
  const status = { enabled: true };
  const edited = { ...teamForm(saved), texts: { ...teamForm(saved).texts, maxChildren: '3' } };
  // The stream drops (failed), then reconnects (loading): the store keeps the last settings, the input stays.
  for (const load of [settingsLoad(status, false, true), settingsLoad(status, false, false)]) {
    assert.notEqual(load.kind, 'ok');
    assert.equal(sectionDirty(saved, edited, 'team'), true, `${load.kind}: the team edit still asks before closing`);
  }
  // Back to ok: the snapshot comes again as a new object with the same values; the edit survives the resync.
  assert.equal(settingsLoad(status, true, false).kind, 'ok');
  const fresh = teamValues({}, [{ id: 'lead', model: 'claude-sonnet-5-5' }]);
  assert.equal(sectionDirty(fresh, resyncTeamForm(saved, fresh, edited), 'team'), true);
});
