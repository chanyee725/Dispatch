// 설정 > 일반 > 기본값 (#724): form state, checks and the patch sent to /api/user-defaults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultsDirty, defaultsErrors, defaultsForm, defaultsPatch } from '../../web/src/settings/sections/userDefaultsForm.ts';

test('defaultsForm: unset values are empty text and PR tracking on', () => {
  assert.deepEqual(defaultsForm({}), { workspace: '', port: '', prStatus: true });
  assert.deepEqual(defaultsForm({ workspace: '~/w', port: 4400, prStatus: false }), { workspace: '~/w', port: '4400', prStatus: false });
});

test('defaultsErrors: paths must start with / or ~/, ports 1024..65535', () => {
  assert.deepEqual(defaultsErrors({ workspace: '', port: '', prStatus: true }), {});
  assert.deepEqual(defaultsErrors({ workspace: '~/w', port: '4400', prStatus: true }), {});
  assert.deepEqual(defaultsErrors({ workspace: '/abs', port: '65535', prStatus: true }), {});
  const e = defaultsErrors({ workspace: 'rel/dir', port: '80', prStatus: true });
  assert.ok(e.workspace && e.port);
  assert.ok(defaultsErrors({ workspace: '~x', port: '4400.5', prStatus: true }).port);
  assert.ok(defaultsErrors({ workspace: '~x', port: '', prStatus: true }).workspace);
});

test('defaultsPatch sends only changes; a cleared field sends null', () => {
  const saved = { workspace: '~/w', port: 4400 };
  assert.deepEqual(defaultsPatch(saved, defaultsForm(saved)), {});
  assert.deepEqual(defaultsPatch(saved, { workspace: ' ~/x ', port: '', prStatus: true }), { workspace: '~/x', port: null });
  assert.deepEqual(defaultsPatch({}, { workspace: '', port: '', prStatus: false }), { prStatus: false });
  assert.deepEqual(defaultsPatch({ prStatus: false }, { workspace: '', port: '', prStatus: true }), { prStatus: true });
});

test('defaultsDirty ignores surrounding spaces', () => {
  assert.equal(defaultsDirty({ workspace: '~/w' }, { workspace: '~/w ', port: '', prStatus: true }), false);
  assert.equal(defaultsDirty({}, { workspace: '', port: '4400', prStatus: true }), true);
});
