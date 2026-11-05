import { test } from "node:test";
import assert from "node:assert/strict";
import { alertCandidates, badgeTitle, nextAlerts, WAIT_ALERT_MS, type Alert } from "../src/lib/alerts.ts";
import { attentionItems, type AttentionItem, type AttentionTask } from "../src/lib/attention.ts";

const NOW = 1_000_000_000;
const names: Record<string, string> = { s1: "Remy", s2: "Ivo" };
const nameOf = (id: string) => names[id];
const item = (x: Partial<AttentionItem>): AttentionItem => ({ key: "s:s1", kind: "session", level: "warn", who: "Remy", reason: "", since: null, sessionId: "s1", ...x });
const reasons = (as: Alert[]) => as.map(a => `${a.key}`);

test("waiting alerts only from 3 minutes", () => {
  const at = (ms: number) => alertCandidates([item({ state: "waiting", since: NOW - ms })], NOW, nameOf);
  assert.deepEqual(at(WAIT_ALERT_MS - 1), []);
  assert.deepEqual(at(WAIT_ALERT_MS).map(a => a.reason), ["wait"]);
  assert.deepEqual(alertCandidates([item({ state: "waiting", since: null })], NOW, nameOf), []);
});

test("failed session alerts at once", () => {
  const [a] = alertCandidates([item({ state: "failed", level: "bad", since: NOW })], NOW, nameOf);
  assert.deepEqual(a, { key: "s:s1|failed", reason: "failed", sessionId: "s1", title: "Remy", body: "오류로 끝났어요" });
});

test("stuck alerts only on a server flag", () => {
  assert.deepEqual(alertCandidates([item({ state: "stuck", flagged: true })], NOW, nameOf).map(a => a.reason), ["stuck"]);
  // Watchdog stall: same shape in the strip, no flag.
  assert.deepEqual(alertCandidates([item({ state: "stuck" })], NOW, nameOf), []);
  // Late by the client clock only.
  assert.deepEqual(alertCandidates([item({ key: "t:1", kind: "late", who: "비밀 작업 제목" })], NOW, nameOf), []);
});

test("task rows are titled by the session, never the task text", () => {
  const [a] = alertCandidates([item({ key: "t:1", kind: "mismatch", who: "비밀 작업 제목", reason: "긴 서버 문장", sessionId: "s2", flagged: true })], NOW, nameOf);
  assert.equal(a.title, "Ivo");
  assert.equal(a.body, "작업이 멈췄어요");
  assert.ok(!JSON.stringify(a).includes("비밀"));
  const [b] = alertCandidates([item({ key: "t:2", kind: "late", who: "x", sessionId: "gone", flagged: true })], NOW, nameOf);
  assert.equal(b.title, "작업");
});

test("limits alert from 90 %", () => {
  const lim = (used: number) => item({ key: "l:five", kind: "limit", who: "Claude 5시간 한도", sessionId: undefined, used });
  assert.deepEqual(alertCandidates([lim(89)], NOW, nameOf), []);
  const [a] = alertCandidates([lim(90)], NOW, nameOf);
  assert.deepEqual(a, { key: "l:five|limit", reason: "limit", sessionId: null, title: "Claude 5시간 한도", body: "90% 썼어요" });
});

test("progress, merge and late-by-estimate rows never alert", () => {
  const rows = [
    item({ state: "working" }), item({ state: "done" }),
    item({ key: "m:1", kind: "merge", level: "bad" }),
    item({ key: "t:1", kind: "late" }),
  ];
  assert.deepEqual(alertCandidates(rows, NOW, nameOf), []);
});

test("same session and reason fires once, again after it clears", () => {
  const c = alertCandidates([item({ state: "failed" })], NOW, nameOf);
  let r = nextAlerts(new Set(), c);
  assert.deepEqual(reasons(r.fire), ["s:s1|failed"]);
  r = nextAlerts(r.active, c);
  assert.deepEqual(r.fire, []);
  r = nextAlerts(r.active, []);
  assert.equal(r.active.size, 0);
  r = nextAlerts(r.active, c);
  assert.deepEqual(reasons(r.fire), ["s:s1|failed"]);
});

test("a new reason on the same session fires", () => {
  const failed = alertCandidates([item({ state: "failed" })], NOW, nameOf);
  const stuck = alertCandidates([item({ state: "stuck", flagged: true })], NOW, nameOf);
  const r = nextAlerts(nextAlerts(new Set(), failed).active, stuck);
  assert.deepEqual(reasons(r.fire), ["s:s1|stuck"]);
});

test("attentionItems marks flags and limit percent", () => {
  const base = { id: "s1", name: "Remy", role: "impl", status: "running", pending: [], updatedAt: NOW } as never;
  const stuck = { ...(base as object), state: "stuck", stuck: { reason: "silent", label: "조용해요", sinceMs: NOW } } as never;
  const stall = { ...(base as object), id: "s2", name: "Ivo", state: "working", stall: { reason: "팀이 쉬어요", since: NOW } } as never;
  const task: AttentionTask = { id: "1", lead: "s1", title: "t", stage: "build", owner: "Remy", etaAt: NOW - 1, stuck: { reason: "over-eta", label: "넘겼어요", stage: "build", sinceMs: NOW } };
  const late: AttentionTask = { ...task, id: "2", stuck: null };
  const items = attentionItems({
    sessions: [stuck, stall], tasks: [task, late], now: NOW, stateOf: (s: { state: never }) => s.state,
    limits: { five: 0.904, seven: 0.5, fiveReset: NOW + 1, sevenReset: NOW + 1 } as never,
  });
  const by = (k: string) => items.find(i => i.key === k)!;
  assert.equal(by("s:s1").flagged, true);
  assert.equal(by("s:s2").flagged, undefined);
  assert.equal(by("t:1").flagged, true);
  assert.equal(by("t:2").flagged, false);
  assert.equal(by("l:five").used, 90);
  const fired = alertCandidates(items, NOW, nameOf).map(a => a.key).sort();
  assert.deepEqual(fired, ["l:five|limit", "s:s1|stuck", "t:1|stuck"]);
});

test("badge title reuses the strip count", () => {
  assert.equal(badgeTitle(0), "Dispatch");
  assert.equal(badgeTitle(2), "(2) Dispatch");
});
