import { test } from "node:test";
import assert from "node:assert/strict";
// The strip's rules live in the web bundle; Node strips its types.
import { attentionItems, elapsed } from "../../web/src/lib/attention.ts";

const NOW = 1_000_000_000;
const MIN = 60_000;
const base = { pending: [], usage: {}, updatedAt: NOW, status: "idle", role: "impl" };
const ses = (o) => ({ ...base, ...o });
const stateOf = s => s.state ?? "resting";
const run = (o) => attentionItems({ sessions: [], tasks: [], limits: null, now: NOW, stateOf, ...o });

test("sessions that need a person, bad first then oldest", () => {
  const items = run({ sessions: [
    ses({ id: "a", name: "Ari", state: "working", attention: null }),
    ses({ id: "b", name: "Bo", state: "waiting", attention: { level: "warn", reason: "사용자 답을 기다려요", since: NOW - 3 * MIN } }),
    ses({ id: "c", name: "Cy", state: "stuck", attention: { level: "warn", reason: "테스트 4회째 실패", since: NOW - 9 * MIN } }),
    ses({ id: "d", name: "Di", state: "failed", attention: { level: "bad", reason: "오류로 멈췄어요", since: NOW - MIN } }),
    ses({ id: "e", name: "Ev", state: "resting", attention: null }),
  ] });
  assert.deepEqual(items.map(i => i.who), ["Di", "Cy", "Bo"]);
  assert.equal(items[0].sessionId, "d");
  assert.equal(items[1].state, "stuck");
});

test("older server without attention falls back to state", () => {
  const [i] = run({ sessions: [ses({ id: "a", name: "Ari", state: "waiting", pending: [{}], stateSince: NOW - MIN })] });
  assert.equal(i.reason, "권한 승인을 기다려요");
  assert.equal(i.since, NOW - MIN);
});

test("watchdog stall on a resting session shows as stuck; done sessions never show", () => {
  const items = run({ sessions: [
    ses({ id: "a", name: "Ari", state: "resting", attention: null, stall: { reason: "관리자가 듣지 않아요", since: NOW - 5 * MIN } }),
    ses({ id: "b", name: "Bo", state: "done", attention: null, stall: { reason: "x", since: NOW } }),
  ] });
  assert.equal(items.length, 1);
  assert.equal(items[0].state, "stuck");
  assert.equal(items[0].reason, "관리자가 듣지 않아요");
});

test("late tasks link to their owner, failed merge checks to the lead", () => {
  const sessions = [ses({ id: "lead1", name: "Faye", state: "resting", attention: null }), ses({ id: "r", name: "Remy", state: "working", attention: null })];
  const items = run({ sessions, tasks: [
    { id: "t1", lead: "lead1", title: "로그인", stage: "impl", owner: "Remy", etaAt: NOW - 14 * MIN },
    { id: "t2", lead: "lead1", title: "배지", stage: "merge", owner: null, etaAt: NOW + MIN,
      mergeCheck: { ok: false, commit: "abc", base: "develop", reason: "abc1234 커밋이 아직 develop에 없어요", at: NOW - 2 * MIN } },
    { id: "t3", lead: "lead1", title: "끝남", stage: "done", owner: "Remy", etaAt: NOW - 60 * MIN },
  ] });
  assert.deepEqual(items.map(i => [i.kind, i.who, i.sessionId]), [["merge", "배지", "lead1"], ["late", "로그인", "r"]]);
  assert.equal(items[1].since, NOW - 14 * MIN);
});

test("limits from 75 %, 90 % is bad", () => {
  const items = run({ limits: { five: 0.92, seven: 0.8, fiveReset: NOW + 60 * MIN, sevenReset: null, updatedAt: NOW } });
  assert.deepEqual(items.map(i => [i.who, i.level, i.reason]), [["Claude 5시간 한도", "bad", "92% 썼어요"], ["Claude 주간 한도", "warn", "80% 썼어요"]]);
  assert.equal(run({ limits: { five: 0.74, seven: null, fiveReset: null, sevenReset: null, updatedAt: null } }).length, 0);
});

const lim = (o) => ({ five: null, seven: null, fiveReset: null, sevenReset: null, updatedAt: NOW, ...o });

test("limit urgency follows the guard settings", () => {
  const guard = { five: 0.8, seven: 0.95 };
  const items = run({ guard, limits: lim({ five: 0.8, seven: 0.9 }) });
  assert.deepEqual(items.map(i => [i.who, i.level]), [["Claude 5시간 한도", "bad"], ["Claude 주간 한도", "warn"]]);
  // A guard below 75 % pulls the row in at the guard itself.
  assert.deepEqual(run({ guard: { five: 0.6, seven: 0.85 }, limits: lim({ five: 0.62 }) }).map(i => i.level), ["bad"]);
  // Default guard (server defaults): weekly is urgent from 85 %.
  assert.equal(run({ limits: lim({ seven: 0.86 }) })[0].level, "bad");
});

test("one rounded percent decides colour and text", () => {
  const [i] = run({ limits: lim({ five: 0.895 }) });
  assert.equal(i.reason, "90% 썼어요");
  assert.equal(i.level, "bad");
  assert.equal(run({ limits: lim({ five: 0.745 }) }).length, 1);
  assert.equal(run({ limits: lim({ five: 0.744 }) }).length, 0);
});

test("a limit window past its reset drops out", () => {
  assert.equal(run({ limits: lim({ five: 0.95, fiveReset: NOW }) }).length, 0);
  assert.equal(run({ limits: lim({ five: 0.95, fiveReset: NOW - MIN }) }).length, 0);
  assert.equal(run({ limits: lim({ five: 0.95, fiveReset: NOW + MIN }) }).length, 1);
});

test("the server's task.stuck decides lateness when present", () => {
  const t = (o) => ({ id: "t", lead: null, title: "로그인", stage: "impl", owner: null, ...o });
  // Past the estimate but under 1.5×: the server says not stuck yet.
  assert.equal(run({ tasks: [t({ etaAt: NOW - MIN, stuck: null })] }).length, 0);
  const [i] = run({ tasks: [t({ etaAt: NOW - 30 * MIN, stuck: { reason: "over-eta", since: NOW - 5 * MIN } })] });
  assert.equal(i.kind, "late");
  assert.equal(i.since, NOW - 30 * MIN);
  // Older server without the field: etaAt < now.
  assert.equal(run({ tasks: [t({ etaAt: NOW - MIN })] }).length, 1);
  assert.equal(run({ tasks: [t({ etaAt: null, stuck: true })] })[0].since, null);
});

test("elapsed", () => {
  assert.equal(elapsed(null, NOW), null);
  assert.equal(elapsed(NOW - 30_000, NOW), "");
  assert.equal(elapsed(NOW - 8 * MIN, NOW), "8분");
  assert.equal(elapsed(NOW - 72 * MIN, NOW), "1시간 12분");
  assert.equal(elapsed(NOW - 3 * 1440 * MIN, NOW), "3일");
});
