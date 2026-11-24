import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askConfirm, askText, currentDialog, resetDialogsForTest, settleDialog, showNotice, subscribeDialogs } from '../../web/src/appDialog.ts';

test('appDialog: requests queue, the oldest shows first and each answer goes to its own caller', async () => {
  resetDialogsForTest();
  const a = askConfirm({ title: '지울까요?', danger: true });
  const b = askText({ title: '새 이름', initial: 'x' });
  const first = currentDialog()!;
  assert.equal(first.request.kind, 'confirm');
  settleDialog(first.id, true);
  assert.equal(await a, true);
  const second = currentDialog()!;
  assert.equal(second.request.kind, 'text');
  settleDialog(second.id, 'y');
  assert.equal(await b, 'y');
  assert.equal(currentDialog(), null);
});

test('appDialog: a dismissed dialog answers false / null, and a stale id answers nothing', async () => {
  resetDialogsForTest();
  const c = askConfirm({ title: 'a' });
  const id = currentDialog()!.id;
  settleDialog(id, undefined); // Esc
  assert.equal(await c, false);
  const t = askText({ title: 'b' });
  settleDialog(id, 'late'); // a late close event of the old dialog
  assert.equal(currentDialog()?.request.title, 'b');
  settleDialog(currentDialog()!.id, null);
  assert.equal(await t, null);
  const n = showNotice({ title: 'c' });
  settleDialog(currentDialog()!.id, true);
  assert.equal(await n, undefined);
});

test('appDialog: subscribers hear opens and answers; currentDialog is stable between changes', () => {
  resetDialogsForTest();
  let calls = 0;
  const off = subscribeDialogs(() => calls++);
  void askConfirm({ title: 'a' });
  assert.equal(currentDialog(), currentDialog());
  settleDialog(currentDialog()!.id, false);
  off();
  void askConfirm({ title: 'b' });
  assert.equal(calls, 2);
  resetDialogsForTest();
});
