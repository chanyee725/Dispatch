import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answeredAsk, issueAskText, runStart, startGate, type StartState } from '../../web/src/chat/lib/askIssue.ts';
import { hasTeam } from '../../web/src/home/issueStart.ts';
import type { Session } from '../../shared/dispatch/types.ts';

test('issueAskText asks for a proposal and says not to start', () => {
  const t = issueAskText(954);
  assert.match(t, /^#954 이슈를 읽고/);
  assert.match(t, /범위, 팀 구성/);
  assert.match(t, /아직 시작하지 마$/);
});

test('answeredAsk: only an assistant entry after the ask counts', () => {
  const ask = { kind: 'user', text: issueAskText(7) };
  const reply = { kind: 'assistant', text: '제안' };
  assert.equal(answeredAsk(undefined, 7), false);
  assert.equal(answeredAsk([reply], 7), false, 'an old reply without the ask');
  assert.equal(answeredAsk([reply, ask], 7), false, 'asked, no answer yet');
  assert.equal(answeredAsk([ask, { kind: 'tool', text: 'gh' }, reply], 7), true);
  assert.equal(answeredAsk([ask, reply, { kind: 'user', text: issueAskText(7) }], 7), false, 'asked again, waiting');
  assert.equal(answeredAsk([{ kind: 'user', text: issueAskText(8) }, reply], 7), false, 'another issue');
});

test('hasTeam: an open session or an open PR', () => {
  const s = (status: string) => ({ status }) as unknown as Session;
  assert.equal(hasTeam({ sessions: [], prs: [] }), false);
  assert.equal(hasTeam({ sessions: [s('done')], prs: [{ state: 'merged' }] }), false);
  assert.equal(hasTeam({ sessions: [s('idle')], prs: [] }), true);
  assert.equal(hasTeam({ sessions: [], prs: [{ state: 'open' }] }), true);
});

const deferred = () => {
  let resolve!: (v: string) => void, reject!: (e: Error) => void;
  const promise = new Promise<string>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

test('runStart: one press per ask; after issue A started, issue B starts again', async () => {
  const gate = startGate();
  const shown: StartState[] = [];
  let runs = 0;
  const work = async () => (runs++, 'ok');
  gate.pin(1);
  await Promise.all([runStart(gate, 1, work, s => shown.push(s)), runStart(gate, 1, work, s => shown.push(s))]);
  assert.equal(runs, 1, 'a double press runs once');
  await runStart(gate, 1, work, s => shown.push(s));
  assert.equal(runs, 1, 'A stays locked after it started');
  gate.pin(2);
  await runStart(gate, 2, work, s => shown.push(s));
  assert.equal(runs, 2, 'B starts');
  assert.deepEqual(shown.at(-1), { state: 'done', text: 'ok' });
});

test("runStart: A's result does not land on B while A was in flight", async () => {
  const gate = startGate();
  const a = deferred();
  const shown: StartState[] = [];
  gate.pin(1);
  const pressA = runStart(gate, 1, () => a.promise, s => shown.push(s));
  gate.pin(2);
  shown.length = 0;
  a.resolve('A에게 보냈어요');
  await pressA;
  assert.deepEqual(shown, [], 'nothing shown for B');
  await runStart(gate, 2, async () => 'B에게 보냈어요', s => shown.push(s));
  assert.deepEqual(shown, [{ state: 'busy' }, { state: 'done', text: 'B에게 보냈어요' }]);
});

test('runStart: a failure unlocks the same ask; a stale failure is ignored', async () => {
  const gate = startGate();
  const shown: StartState[] = [];
  gate.pin(1);
  await runStart(gate, 1, async () => { throw new Error('x'); }, s => shown.push(s));
  assert.deepEqual(shown.at(-1), { state: 'error', text: '시작하지 못했어요. x' });
  await runStart(gate, 1, async () => 'ok', s => shown.push(s));
  assert.deepEqual(shown.at(-1), { state: 'done', text: 'ok' }, 'retry works');
  const late = deferred();
  gate.pin(2);
  const pressB = runStart(gate, 2, () => late.promise, s => shown.push(s));
  gate.pin(3);
  shown.length = 0;
  late.reject(new Error('late'));
  await pressB;
  assert.deepEqual(shown, []);
});
