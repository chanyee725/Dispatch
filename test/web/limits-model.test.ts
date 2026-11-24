import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_FIELDS, changedValues, fableFollows, guardDirty, guardPatch, guardValue, readGuardTexts, stopEscWhileOpen, wholeIn } from '../../web/src/settings/model.ts';

const settings = { guard: { enabled: true, five: 0.9, seven: 0.85 }, team: { ctxHandoff: 60 } };

test('guardValue shows percent, falls back to weekly for fable and to the default for unset team values', () => {
  assert.equal(guardValue('five', settings), 90);
  assert.equal(guardValue('seven', settings), 85);
  assert.equal(guardValue('fable', settings), 85);
  assert.equal(guardValue('fable', { ...settings, guard: { ...settings.guard, fable: 0.7 } }), 70);
  assert.equal(guardValue('ctxHandoff', settings), 60);
  assert.equal(guardValue('handoffMTokens', settings), 15);
});

test('guardPatch turns percents into fractions and never sends enabled', () => {
  assert.deepEqual(guardPatch({ five: 80, handoffMTokens: 20 }), { guard: { five: 0.8 }, team: { handoffMTokens: 20 } });
  assert.deepEqual(guardPatch({ fable: 100 }), { guard: { fable: 1 } });
  assert.deepEqual(guardPatch({ fable: null }), { guard: { fable: null } });
  assert.deepEqual(guardPatch({}), {});
});

test('wholeIn accepts only whole numbers in range; no field can reach 0 (guards stay on)', () => {
  assert.equal(wholeIn('85', 1, 100), 85);
  for (const bad of ['', ' ', '0', '101', '1.5', 'abc']) assert.equal(wholeIn(bad, 1, 100), null);
  for (const f of GUARD_FIELDS.flatMap((g) => g.fields)) {
    assert.ok(f.min >= 1 && f.def >= f.min && f.def <= f.max, f.id);
  }
});

const shown = { five: 90, seven: 85, fable: 85, handoffMTokens: 15, ctxHandoff: 70 };

test('changedValues sends only changed fields and never pins a Fable value that follows weekly (#552)', () => {
  const following = { values: shown, fableFollows: true };
  assert.deepEqual(changedValues(following, shown, true), {});
  // 주간 85→70 while Fable follows: the field mirrors 70, but Fable is not sent, so the server keeps following.
  assert.deepEqual(changedValues(following, { ...shown, seven: 70, fable: 70 }, true), { seven: 70 });
  // The user typed a Fable value: it is pinned, even when it equals the value shown.
  assert.deepEqual(changedValues(following, shown, false), { fable: 85 });
  assert.deepEqual(changedValues(following, { ...shown, fable: 60 }, false), { fable: 60 });
});

test('changedValues clears an own Fable value when it should follow weekly again (모두 기본값으로)', () => {
  const pinned = { values: { ...shown, five: 80, fable: 60 }, fableFollows: false };
  assert.deepEqual(changedValues(pinned, shown, true), { five: 90, fable: null });
  assert.deepEqual(changedValues(pinned, pinned.values, false), {});
  assert.deepEqual(changedValues(pinned, { ...pinned.values, fable: 70 }, false), { fable: 70 });
  assert.equal(fableFollows({ guard: {} }), true);
  assert.equal(fableFollows({ guard: { fable: 0.6 } }), false);
});

const texts = { five: '90', seven: '85', fable: '60', handoffMTokens: '15', ctxHandoff: '70' };

test('readGuardTexts: an empty Fable field follows weekly (fable: null), never a range error (#563)', () => {
  const pinned = { values: { ...shown, fable: 60 }, fableFollows: false };
  for (const empty of ['', '  ']) {
    const read = readGuardTexts({ ...texts, fable: empty }, false);
    assert.ok(!('error' in read), JSON.stringify(read));
    assert.equal(read.follows, true);
    assert.equal(read.values.fable, 85, 'takes the weekly value');
    assert.deepEqual(guardPatch(changedValues(pinned, read.values, read.follows)), { guard: { fable: null } });
  }
  // Already following: an empty Fable field sends nothing for Fable.
  const read = readGuardTexts({ ...texts, fable: '' }, true);
  assert.ok(!('error' in read));
  assert.deepEqual(changedValues({ values: shown, fableFollows: true }, read.values, read.follows), {});
});

test('readGuardTexts keeps a typed Fable value and still rejects bad values in any field', () => {
  assert.deepEqual(readGuardTexts(texts, false), { values: { ...shown, fable: 60 }, follows: false });
  assert.deepEqual(readGuardTexts({ ...texts, fable: '0' }, false), { error: 'Fable 주간 한도: 1~100 사이 숫자를 넣어 주세요' });
  assert.deepEqual(readGuardTexts({ ...texts, seven: '', fable: '' }, false), { error: '주간 한도: 1~100 사이 숫자를 넣어 주세요' });
  assert.deepEqual(readGuardTexts({ ...texts, five: '' }, true), { error: '5시간 한도: 1~100 사이 숫자를 넣어 주세요' });
});

test('stopEscWhileOpen stops Esc only while open, and its cleanup removes the listener (#563)', () => {
  const target = new EventTarget();
  let open = true;
  const stop = stopEscWhileOpen(target, () => open);
  // Reports whether the listener called stopPropagation on the event.
  const fire = (key: string) => {
    const e = new Event('keydown') as Event & { key: string };
    e.key = key;
    let stopped = false;
    const orig = e.stopPropagation.bind(e);
    e.stopPropagation = () => ((stopped = true), orig());
    target.dispatchEvent(e);
    return stopped;
  };
  assert.equal(fire('Escape'), true);
  assert.equal(fire('Enter'), false);
  open = false;
  assert.equal(fire('Escape'), false, 'closed: Esc passes');
  open = true;
  stop();
  assert.equal(fire('Escape'), false, 'after cleanup nothing listens');
});

test('guardDirty: unsaved input is a typed value off the saved one or a Fable follow change, not the mirrored Fable (#638)', () => {
  const ids = GUARD_FIELDS.flatMap((g) => g.fields).map((f) => f.id);
  const values = Object.fromEntries(ids.map((id, i) => [id, 10 + i])) as Record<(typeof ids)[number], number>;
  values.fable = values.seven;
  const saved = { values, fableFollows: true };
  const texts = Object.fromEntries(ids.map((id) => [id, String(values[id])])) as Record<(typeof ids)[number], string>;
  assert.equal(guardDirty(saved, texts, true), false);
  assert.equal(guardDirty(saved, { ...texts, fable: '' }, true), false, 'a cleared, following Fable is not an edit');
  assert.equal(guardDirty(saved, { ...texts, five: '0' }, true), true, 'an invalid value is still unsaved input');
  assert.equal(guardDirty(saved, { ...texts, fable: '50' }, false), true, 'pinning Fable is an edit');
  assert.equal(guardDirty({ values, fableFollows: false }, texts, true), true, 'following again is an edit');
  assert.equal(guardDirty(saved, { ...texts, five: `0${values.five}` }, true), false, 'the same number spelled 0-padded is not an edit (#644)');
  assert.equal(guardDirty(saved, { ...texts, five: ' ' }, true), true, 'a cleared field is an edit (#644)');
});
