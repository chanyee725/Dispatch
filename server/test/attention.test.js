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

test("task.stuck over-eta: one late row with the server's sentence", () => {
  const t = (o) => ({ id: "t", lead: null, title: "로그인", stage: "impl", owner: "Remy", ...o });
  const over = { reason: "over-eta", label: "예상 20분의 1.5배를 넘겼어요", stage: "impl", etaMinutes: 20, sinceMs: NOW - 5 * MIN };
  const items = run({ tasks: [t({ etaAt: NOW - 15 * MIN, stuck: over })] });
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].kind, items[0].reason, items[0].since], ["late", "예상 20분의 1.5배를 넘겼어요 · Remy", NOW - 15 * MIN]);
  // Past the estimate, not yet flagged (server leaves stuck unset or null): still late, plain wording.
  assert.equal(run({ tasks: [t({ etaAt: NOW - MIN, stuck: null })] })[0].reason, "예상 시간을 넘겼어요 · Remy");
  assert.equal(run({ tasks: [t({ etaAt: NOW - MIN })] }).length, 1);
  assert.equal(run({ tasks: [t({ etaAt: NOW + MIN })] }).length, 0);
});

test("task.stuck stage-mismatch: its own row, unless the owner session already shows", () => {
  const mis = { reason: "stage-mismatch", label: "보드는 구현인데 15분 넘게 테스트 실행 중이에요", stage: "impl", activity: "테스트 실행", sinceMs: NOW - 15 * MIN };
  const task = { id: "t", lead: "L", title: "로그인", stage: "impl", owner: "Remy", etaAt: NOW - MIN, stuck: mis };
  const busy = ses({ id: "r", name: "Remy", state: "working", attention: null });
  const items = run({ sessions: [busy], tasks: [task] });
  assert.deepEqual(items.map(i => [i.kind, i.sessionId, i.since]), [["mismatch", "r", NOW - 15 * MIN]]);
  assert.equal(items[0].reason, `${mis.label} · Remy`);
  // Owner is flagged repeat-fail: the session row says it; the task adds no second row about the same loop.
  const looping = ses({ id: "r", name: "Remy", state: "stuck", stuck: { reason: "repeat-fail", label: "테스트 3번 연속 실패", sinceMs: NOW - 4 * MIN },
    attention: { level: "warn", reason: "테스트 3번 연속 실패", since: NOW - 4 * MIN } });
  const both = run({ sessions: [looping], tasks: [{ ...task, etaAt: null, stuck: { ...mis, reason: "stage-mismatch" } }] });
  assert.deepEqual(both.map(i => [i.kind, i.reason]), [["session", "테스트 3번 연속 실패"]]);
});

test("session.stuck reaches the strip once, through state + attention (or the fallback)", () => {
  const stuck = { reason: "silent", label: "10분째 출력이 없어요", sinceMs: NOW - 12 * MIN };
  const withAttention = run({ sessions: [ses({ id: "a", name: "Ari", state: "stuck", stuck, attention: { level: "warn", reason: stuck.label, since: stuck.sinceMs } })] });
  assert.deepEqual(withAttention.map(i => [i.reason, i.since]), [[stuck.label, NOW - 12 * MIN]]);
  const fallback = run({ sessions: [ses({ id: "a", name: "Ari", state: "stuck", stuck })] });
  assert.deepEqual(fallback.map(i => [i.reason, i.since]), [[stuck.label, NOW - 12 * MIN]]);
});

test("elapsed", () => {
  assert.equal(elapsed(null, NOW), null);
  assert.equal(elapsed(NOW - 30_000, NOW), "");
  assert.equal(elapsed(NOW - 8 * MIN, NOW), "8분");
  assert.equal(elapsed(NOW - 72 * MIN, NOW), "1시간 12분");
  assert.equal(elapsed(NOW - 3 * 1440 * MIN, NOW), "3일");
});
