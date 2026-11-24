import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeText, mainTarget, helperBody, helperOffline, sendOnce, sendsOnEnter, sessionGone, unread } from '../web/src/chat/lib/chatDock.ts';
import type { Entry, Session } from '../shared/dispatch/types.ts';

const ses = (id: string, status: Session['status'], startedAt: number, name = id) =>
  ({ id, status, startedAt, name, roleName: '팀원' }) as Session;

test('mainTarget: always the helper; its id only while alive', () => {
  const list = [ses('a', 'running', 1), ses('h', 'waiting', 0)];
  assert.deepEqual([mainTarget(list, 'h').key, mainTarget(list, 'h').id], ['helper', 'h']);
  // No helper yet, or the helper ended: no id, so the next send makes a new one.
  assert.equal(mainTarget(list, null).id, null);
  assert.equal(mainTarget([ses('h', 'done', 0)], 'h').id, null);
  // Just made, not in the list yet: keep its id so a second send does not make another helper.
  assert.equal(mainTarget([], 'h').id, 'h');
});

test('unread counts replies after the last seen count; badge caps at 9+', () => {
  const e = (kind: Entry['kind']) => ({ kind, text: 'x', at: 0 }) as Entry;
  const entries = [e('user'), e('assistant'), e('tool'), e('assistant'), e('assistant')];
  assert.equal(unread(entries, 1), 2);
  assert.equal(unread(entries, 5), 0);
  assert.equal(unread(undefined, 0), 0);
  assert.deepEqual([badgeText(0), badgeText(3), badgeText(12)], ['', '3', '9+']);
});

test('helperBody: lead role, sonnet 5.5, perm auto, no worktree, the project folder', () => {
  assert.deepEqual(helperBody('안녕', 'proj'), {
    commonPrompt: '안녕', worktree: false, folder: 'proj',
    items: [{ role: 'lead', model: 'claude-sonnet-5-5', effort: null, perm: 'auto', n: 1 }],
  });
  assert.equal('folder' in helperBody('x', null), false);
  // #968 s2: a resumed CLI session rides on the item; images on the body.
  const img = { mediaType: 'image/png', data: 'AAAA' };
  const b = helperBody('', 'proj', { resume: 'abc-1', images: [img] });
  assert.deepEqual(b.items[0], { role: 'lead', model: 'claude-sonnet-5-5', effort: null, perm: 'auto', n: 1, resume: 'abc-1' });
  assert.deepEqual(b.images, [img]);
  assert.equal('images' in helperBody('x', null, { images: [] }), false);
});

test('sendsOnEnter: Enter sends; Shift+Enter and IME composition do not', () => {
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: false }), true);
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: true }), false);
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: false, isComposing: true }), false);
  assert.equal(sendsOnEnter({ key: 'a', shiftKey: false }), false);
  // A Korean IME's committing Enter (keyCode 229) and a held key (repeat) do not send either (#950).
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: false, keyCode: 229 }), false);
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: false, keyCode: 13, repeat: true }), false);
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: false, keyCode: 13, repeat: false }), true);
});

test('helperOffline: only the not-yet-made helper with Claude known as not connected', () => {
  const helper = mainTarget([], null);
  assert.equal(helperOffline(helper, { claude: { connected: false } }), true);
  assert.equal(helperOffline(helper, { claude: { connected: true } }), false);
  // Provider list not loaded yet: do not block; the server answers.
  assert.equal(helperOffline(helper, {}), false);
  // A helper already made, or another session, is not blocked here.
  assert.equal(helperOffline(mainTarget([], 'h'), { claude: { connected: false } }), false);
  assert.equal(helperOffline({ key: 's1', id: 's1', label: 'x' }, { claude: { connected: false } }), false);
});

test('sendOnce: two Enters before a re-render run the send once; the lock opens again after, also on failure', async () => {
  const lock = { current: false };
  let runs = 0;
  let finish!: () => void;
  const run = () => { runs++; return new Promise<void>(r => { finish = r; }); };
  const first = sendOnce(lock, run);
  const second = sendOnce(lock, run);
  assert.equal(await second, false);
  finish();
  assert.equal(await first, true);
  assert.equal(runs, 1);
  await assert.rejects(sendOnce(lock, async () => { throw new Error('x'); }));
  assert.equal(lock.current, false);
  assert.equal(await sendOnce(lock, async () => {}), true);
});

test('sessionGone: only a 404 forgets the helper', () => {
  assert.equal(sessionGone(Object.assign(new Error('세션이 없어요'), { status: 404 })), true);
  assert.equal(sessionGone(Object.assign(new Error('HTTP 500'), { status: 500 })), false);
  assert.equal(sessionGone(new TypeError('Failed to fetch')), false);
});

import { chatRecord, imagesBody, isClear, isCliSessionId, parseDataUrl, pickImages, slashItems, slashQuery, usageText, withPrior, worthSaving } from '../web/src/chat/lib/chatInput.ts';

test('pickImages: type, size and the 4-image cap; the rest still attach', () => {
  const png = { type: 'image/png', size: 100 };
  assert.deepEqual(pickImages([png, { type: 'text/plain', size: 1 }, png], 0), { ok: [0, 2], error: 'PNG, JPEG, GIF, WebP 이미지만 붙일 수 있어요.' });
  assert.equal(pickImages([png], 4).error, '이미지는 한 번에 4장까지 붙일 수 있어요.');
  assert.equal(pickImages([{ type: 'image/png', size: 4e6 }], 0).ok.length, 0);
  assert.deepEqual(pickImages([png], 3), { ok: [0], error: null });
});

test('parseDataUrl and imagesBody: only base64 images; the body carries no name', () => {
  assert.deepEqual(parseDataUrl('data:image/png;base64,QUJD'), { mediaType: 'image/png', data: 'QUJD' });
  assert.equal(parseDataUrl('data:text/html;base64,QUJD')?.mediaType, 'text/html');
  assert.equal(parseDataUrl('https://x/y.png'), null);
  assert.deepEqual(imagesBody([{ id: '1', mediaType: 'image/png', data: 'QUJD', name: 'a.png' }]), [{ mediaType: 'image/png', data: 'QUJD' }]);
});

test('slash menu: opens only for one slash word; /clear is built in; skills match name or description', () => {
  assert.equal(slashQuery('/'), '');
  assert.equal(slashQuery('/cl'), 'cl');
  assert.equal(slashQuery('/clear now'), null);
  assert.equal(slashQuery('hi /x'), null);
  const skills = [{ name: 'atelier-doc', description: '문서 쓰기' }, { name: 'loop', description: 'clear a queue' }];
  assert.deepEqual(slashItems('cl', skills).map(i => i.name), ['clear', 'loop']);
  assert.deepEqual(slashItems('문서', skills).map(i => i.name), ['atelier-doc']);
  assert.equal(slashItems('', skills).length, 3);
  assert.equal(isClear('/clear '), true);
  assert.equal(isClear('/clearx'), false);
});

test('chatRecord: text and tool names only; tools attach to the answer before them; worthSaving needs both sides', () => {
  const e = (kind: Entry['kind'], text: string, extra: Partial<Entry> = {}) => ({ kind, text, at: 0, ...extra }) as Entry;
  const list = [e('user', '[이미지 1장]'), e('assistant', '확인할게요'), e('tool', '{"command":"ls"}', { tool: 'Bash', label: 'ls' }), e('tool_result', 'SECRET')];
  const rec = chatRecord(list, 's1', 'abc12345');
  assert.deepEqual(rec.messages, [{ role: 'user', text: '[이미지 1장]' }, { role: 'assistant', text: '확인할게요', tools: [{ name: 'Bash', summary: 'ls' }] }]);
  assert.equal(JSON.stringify(rec).includes('SECRET'), false);
  assert.equal(rec.id, 'abc12345');
  assert.equal(worthSaving(list), true);
  assert.equal(worthSaving([e('user', 'hi')]), false);
});

test('withPrior: a reopened conversation saves its earlier messages first', () => {
  const rec = { sessionId: 's1', messages: [{ role: 'user' as const, text: 'new' }] };
  assert.deepEqual(withPrior(rec, [{ role: 'assistant', text: 'old' }]).messages.map(m => m.text), ['old', 'new']);
  assert.equal(withPrior(rec, null), rec);
});

test('usageText: tokens and cost in one quiet line; empty before use', () => {
  const u = (n: number) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(usageText(undefined, null), '');
  assert.equal(usageText(u(0), 0), '');
  assert.equal(usageText(u(12_345), 0.0421), '12.3k 토큰 · $0.042');
  assert.equal(usageText(u(2_500_000), 12.5), '2.50M 토큰 · $12.50');
  assert.equal(usageText(u(900), null), '900 토큰');
});

test('isCliSessionId: the saved id shape only', () => {
  assert.equal(isCliSessionId('3f2a-b_C9'), true);
  for (const bad of ['', '../x', 'a b', 'x'.repeat(81), 5, null]) assert.equal(isCliSessionId(bad), false);
});
