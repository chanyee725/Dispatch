// Shared PR/CI tracking logic (#425): drives createPrTracking over the real api client with the
// /api/workspace/pr-tracking route stubbed at fetch, and the status line it reports into.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPrTracking, type PrState } from '../../web/src/dispatch/prTracking.ts';
import { createStatusLine } from '../../web/src/statusLine.ts';

type Reply = { status?: number; body: unknown; delay?: number };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Stub the route; `replies` is consumed in request order. Records method + body of every call. */
function stubRoute(replies: Reply[]) {
  const calls: { method: string; body: unknown; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/workspace/pr-tracking');
    calls.push({ method: init.method!, body: init.body === undefined ? undefined : JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const r = replies[calls.length - 1];
    if (r.delay) await sleep(r.delay);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body } as Response;
  }) as typeof fetch;
  return calls;
}
function setup(savedNote?: string, delayMs = 20) {
  const notes: (string | null)[] = [];
  const states: PrState[] = [];
  const status = createStatusLine((t) => notes.push(t), delayMs);
  const ctl = createPrTracking({ status, onState: (s) => states.push(s), savedNote });
  return { notes, states, status, ctl };
}
const BROKEN = { error: '설정 파일을 읽을 수 없어요.' };

test('toggle posts {on} with x-drawing, shows the server answer and a saved note after the clear', async () => {
  const calls = stubRoute([{ body: { on: true } }, { body: { on: false } }]);
  const { notes, states, ctl } = setup();
  await ctl.load();
  await ctl.toggle(false);
  await sleep(60);
  assert.deepEqual(calls.map((c) => [c.method, c.body]), [['GET', undefined], ['POST', { on: false }]]);
  assert.equal(calls[1].headers['x-drawing'], '1');
  assert.deepEqual(states, [true, false]);
  assert.deepEqual(notes, [null, '저장했어요.'], 'cleared at once, written only after the delay');
});

test('a late first response never overwrites the newer toggle', async () => {
  stubRoute([{ body: { on: false }, delay: 80 }, { body: { on: true } }]);
  const { notes, states, ctl } = setup();
  const first = ctl.toggle(false);
  await sleep(10);
  await ctl.toggle(true);
  await first;
  await sleep(60);
  assert.deepEqual(states, [true]);
  assert.equal(notes.at(-1), '저장했어요.');
});

test('a 409 shows its cause once, the retry that still fails says so, and recovering clears it', async () => {
  stubRoute([{ status: 409, body: BROKEN }, { status: 409, body: BROKEN }, { body: { on: true } }]);
  const { notes, states, ctl } = setup();
  await ctl.toggle(true);
  await sleep(50);
  assert.deepEqual(states, [{ broken: BROKEN.error }]);
  assert.deepEqual(notes, [null], 'first 409: no retry notice');
  await ctl.toggle(true);
  await sleep(50);
  assert.equal(notes.at(-1), '아직 읽을 수 없어요.');
  await ctl.toggle(true);
  await sleep(50);
  assert.deepEqual(states.at(-1), true);
  assert.equal(notes.at(-1), '다시 불러왔어요.');
});

test('savedNote can be silent for a switch that shows success itself', async () => {
  stubRoute([{ body: { on: true } }, { status: 409, body: BROKEN }, { body: { on: true } }]);
  const { notes, ctl } = setup('');
  await ctl.toggle(true);
  await sleep(50);
  assert.equal(notes.at(-1), '');
  await ctl.toggle(true);
  await ctl.toggle(true);
  await sleep(50);
  assert.equal(notes.at(-1), '', 'recovering from a broken file stays silent too');
});

test('a failed save is announced as an error; no route means unsupported', async () => {
  stubRoute([{ status: 500, body: { error: '저장하지 못했어요.' } }, { status: 404, body: {} }]);
  const { notes, states, ctl } = setup();
  await ctl.toggle(true);
  await sleep(50);
  assert.equal(notes.at(-1), '저장하지 못했어요.');
  await ctl.load();
  assert.equal(states.at(-1), 'unsupported');
});

test('a late error from an older action does not stick once the newer action has written', async () => {
  const notes: (string | null)[] = [];
  const s = createStatusLine((t) => notes.push(t), 10);
  const a = s.begin();
  const b = s.begin();
  s.announce(b, '저장했어요.');
  await sleep(40);
  s.announce(a, '늦은 오류', true); // dropped: the newer text is already shown
  const c = s.begin();
  s.announce(c, '다음 저장');
  await sleep(40);
  assert.equal(notes.at(-1), '다음 저장', 'no stale error appended to an unrelated later text');
});

test('an older error that arrives while the newer action is still in flight is carried onto its text', async () => {
  const notes: (string | null)[] = [];
  const s = createStatusLine((t) => notes.push(t), 10);
  const a = s.begin();
  const b = s.begin();
  s.announce(a, '오래된 오류', true);
  s.announce(b, '저장했어요.');
  await sleep(40);
  assert.equal(notes.at(-1), '저장했어요. 오래된 오류');
});

test('after the newest action settles through dropCarried, a late older error is dropped (#433)', async () => {
  const notes: (string | null)[] = [];
  const s = createStatusLine((t) => notes.push(t), 10);
  const a = s.begin();
  const b = s.begin();
  s.dropCarried(); // b got a 409: its cause is on its own line, nothing is written here
  s.announce(a, '늦은 오류', true);
  const c = s.begin();
  s.announce(c, '다음 저장');
  await sleep(40);
  assert.equal(notes.at(-1), '다음 저장');
});

test('a carried error on a silent text has no leading space (#433)', async () => {
  const notes: (string | null)[] = [];
  const s = createStatusLine((t) => notes.push(t), 10);
  const a = s.begin();
  const b = s.begin();
  s.announce(a, '오래된 오류', true);
  s.announce(b, '');
  await sleep(40);
  assert.equal(notes.at(-1), '오래된 오류');
});
