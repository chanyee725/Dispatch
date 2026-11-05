import { test } from "node:test";
import assert from "node:assert/strict";
import { byUrgency, stateStart } from "../src/lib/order.ts";

type S = { id: string; startedAt: number; stateSince?: number; stuck?: { reason: string; label: string; sinceMs: number | null } | null; st: string };
const mk = (id: string, st: string, stateSince: number, startedAt = 0, extra: Partial<S> = {}): S => ({ id, st, stateSince, startedAt, ...extra });
const order = (ss: S[]) => byUrgency(ss as never[], (s: S) => s.st as never).map((s: S) => s.id);

test("urgency: failed > waiting > stuck > working > resting > done", () => {
  const ss = [mk("d", "done", 1), mk("r", "resting", 1), mk("w", "working", 1), mk("s", "stuck", 1), mk("q", "waiting", 1), mk("f", "failed", 1)];
  assert.deepEqual(order(ss), ["f", "q", "s", "w", "r", "d"]);
});

test("same state: the longest-standing first", () => {
  assert.deepEqual(order([mk("new", "waiting", 300), mk("old", "waiting", 100), mk("mid", "waiting", 200)]), ["old", "mid", "new"]);
});

test("ties fall back to start time, then id", () => {
  const ss = [mk("b", "working", 50, 10), mk("a", "working", 50, 10), mk("c", "working", 50, 5)];
  assert.deepEqual(order(ss), ["c", "a", "b"]);
});

test("order does not depend on input order or time passing", () => {
  const ss = [mk("x", "resting", 10), mk("y", "resting", 10), mk("z", "failed", 99)];
  const a = order(ss), b = order([...ss].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(a, ["z", "x", "y"]);
});

test("does not mutate the input", () => {
  const ss = [mk("r", "resting", 1), mk("f", "failed", 1)];
  order(ss);
  assert.deepEqual(ss.map(s => s.id), ["r", "f"]);
});

test("stateStart: stuck counts from the stuck flag; missing stateSince falls back to startedAt", () => {
  assert.equal(stateStart({ id: "a", startedAt: 5, stateSince: 50, stuck: { reason: "silent", label: "", sinceMs: 20 } }, "stuck"), 20);
  assert.equal(stateStart({ id: "a", startedAt: 5, stateSince: 50 }, "working"), 50);
  assert.equal(stateStart({ id: "a", startedAt: 5 }, "resting"), 5);
});
