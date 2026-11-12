import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub } from "../sessions.js";
import { attentionOf, ctxOver, ctxShare } from "../state.js";

// A Hub stand-in with just what checkCtx(), shouldRotate() and publicSession() reach for.
function fakeHub(s, rt, team = {}) {
  const live = new Map([[s.id, rt]]);
  return Object.assign(Object.create(Hub.prototype), {
    live, store: { data: { sessions: { [s.id]: s }, settings: { team } }, save() {} }, emit() {},
  });
}

const fakeProc = () => { const lines = []; return { lines, stdin: { write: l => lines.push(JSON.parse(l)) } }; };
const rt = proc => ({ proc, transcript: [], written: 0, perms: new Map(), fails: new Map(), checks: new Map(), lastEventAt: 0 });
const session = (over = {}) => ({ id: "a", name: "Mina", provider: "claude", status: "running", parent: "lead",
  ctx: 0, ctxWindow: 200_000, providerSessionId: "p1", turns: 0, turnsSinceRotate: 0, ...over });

test("ctxShare / ctxOver: percent threshold, 0 turns it off, unknown window never trips", () => {
  assert.equal(ctxShare({ ctx: 50, ctxWindow: 200 }), 0.25);
  assert.equal(ctxShare({ ctx: 50, ctxWindow: 0 }), null);
  assert.equal(ctxOver({ ctx: 140, ctxWindow: 200 }, { ctxHandoff: 70 }), true);
  assert.equal(ctxOver({ ctx: 139, ctxWindow: 200 }, { ctxHandoff: 70 }), false);
  assert.equal(ctxOver({ ctx: 199, ctxWindow: 200 }, { ctxHandoff: 0 }), false);
  assert.equal(ctxOver({ ctx: 199 }, { ctxHandoff: 70 }), false);
});

test("checkCtx: a running Claude session over the guard is told once, mid-turn, to wrap up", () => {
  const proc = fakeProc();
  const s = session({ ctx: 150_000 });
  const hub = fakeHub(s, rt(proc));
  hub.checkCtx(s, 1000);
  assert.deepEqual(s.ctxHigh, { pct: 75, sinceMs: 1000 });
  assert.equal(proc.lines.length, 1);
  assert.equal(proc.lines[0].type, "user");
  assert.match(proc.lines[0].message.content, /컨텍스트를 75% 썼다/);
  s.ctx = 170_000;
  hub.checkCtx(s, 2000);
  assert.equal(proc.lines.length, 1, "no second notice in the same CLI session");
  assert.deepEqual(s.ctxHigh, { pct: 85, sinceMs: 1000 }, "pct follows, since stays");
});

test("checkCtx: under the guard, or guard off, does nothing", () => {
  const proc = fakeProc();
  const s = session({ ctx: 100_000 });
  fakeHub(s, rt(proc)).checkCtx(s);
  assert.equal(s.ctxHigh, undefined);
  const s2 = session({ ctx: 190_000 });
  fakeHub(s2, rt(proc), { ctxHandoff: 0 }).checkCtx(s2);
  assert.equal(s2.ctxHigh, undefined);
  assert.equal(proc.lines.length, 0);
});

test("checkCtx: Codex is flagged but not written to mid-turn", () => {
  const proc = fakeProc();
  const s = session({ provider: "openai", ctx: 190_000 });
  fakeHub(s, rt(proc)).checkCtx(s);
  assert.equal(s.ctxHigh.pct, 95);
  assert.equal(proc.lines.length, 0);
});

test("shouldRotate: over the guard rotates at the next message even with zero finished turns", () => {
  const s = session({ status: "idle", ctx: 150_000, turnsSinceRotate: 0 });
  const hub = fakeHub(s, rt(null));
  assert.equal(hub.shouldRotate(s), true);
  s.ctx = 10_000;
  assert.equal(hub.shouldRotate(s), false);
  s.ctx = 150_000; s.status = "running";
  assert.equal(hub.shouldRotate(s), false, "never mid-turn");
  s.status = "idle"; s.providerSessionId = null;
  assert.equal(hub.shouldRotate(s), false, "nothing to rotate away from");
});

test("shouldRotate: the turn budget still applies under the guard", () => {
  const s = session({ status: "idle", ctx: 1000, turnsSinceRotate: 10 });
  assert.equal(fakeHub(s, rt(null)).shouldRotate(s), true);
});

test("attention: a resting or working session over the guard shows a warning; real states win", () => {
  const s = { ctxHigh: { pct: 82, sinceMs: 5 } };
  assert.deepEqual(attentionOf(s, "working", 0, 1), { level: "warn", reason: "컨텍스트를 82% 썼어요", since: 5 });
  assert.equal(attentionOf(s, "failed", 0, 1).reason, "오류로 멈췄어요");
  assert.equal(attentionOf(s, "done", 0, 1), null);
  assert.equal(attentionOf({}, "resting", 0, 1), null);
});
