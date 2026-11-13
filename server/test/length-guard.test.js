import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../sessions.js";
import { attentionOf, longOver, mtokens } from "../state.js";
import { noteFor, run } from "../../hooks/long-session.mjs";

// A Hub stand-in with just what checkLong() and send() reach for (issue #29).
function fakeHub(sessions, rts, team = {}) {
  const live = new Map(Object.entries(rts));
  const sent = [];
  const hub = Object.assign(Object.create(Hub.prototype), {
    live, store: { data: { sessions: Object.fromEntries(sessions.map(s => [s.id, s])), settings: { team } }, save() {} }, emit() {},
  });
  hub.sentTo = sent;
  hub.send = (id, text) => sent.push({ id, text });
  return hub;
}
const fakeProc = () => { const lines = []; return { lines, stdin: { write: l => lines.push(JSON.parse(l)) } }; };
const rt = proc => ({ proc, transcript: [], written: 0, perms: new Map(), fails: new Map(), checks: new Map(), lastEventAt: 0 });
const M = n => ({ input: 0, output: 0, cacheRead: n * 1e6, cacheWrite: 0 });

test("mtokens / longOver: counts every kind of token, 0 turns the guard off", () => {
  assert.equal(mtokens({ usage: { input: 1e6, output: 1e6, cacheRead: 2e6, cacheWrite: 1e6 } }), 5);
  assert.equal(mtokens({}), 0);
  assert.equal(longOver({ usage: M(15) }, { handoffMTokens: 15 }), true);
  assert.equal(longOver({ usage: M(14.9) }, { handoffMTokens: 15 }), false);
  assert.equal(longOver({ usage: M(99) }, { handoffMTokens: 0 }), false);
});

test("checkLong: a long teammate's lead is told once to replace it", () => {
  const kid = { id: "k", name: "Pax", roleName: "구현자", parent: "L", provider: "claude", status: "running", usage: M(16) };
  const lead = { id: "L", name: "Jae", canSpawn: true, provider: "claude", status: "idle", usage: M(1) };
  const proc = fakeProc();
  const hub = fakeHub([kid, lead], { k: rt(proc), L: rt(null) }, { handoffMTokens: 15 });
  hub.checkLong(kid, 1000);
  assert.deepEqual(kid.longRun, { mtok: 16, sinceMs: 1000 });
  assert.equal(hub.sentTo.length, 1);
  assert.equal(hub.sentTo[0].id, "L");
  assert.match(hub.sentTo[0].text, /Pax\(구현자\) 세션이 누적 16M 토큰/);
  assert.match(hub.sentTo[0].text, /새 팀원에게 맡겨라/);
  assert.equal(proc.lines.length, 0, "the teammate itself is not interrupted");
  kid.usage = M(20);
  hub.checkLong(kid, 2000);
  assert.equal(hub.sentTo.length, 1, "only once");
  assert.deepEqual(kid.longRun, { mtok: 20, sinceMs: 1000 });
});

test("checkLong: a running lead is told mid-turn to hand over; an idle one gets it with its next message", () => {
  const proc = fakeProc();
  const lead = { id: "L", name: "Hugo", canSpawn: true, provider: "claude", status: "running", usage: M(29) };
  fakeHub([lead], { L: rt(proc) }, { handoffMTokens: 15 }).checkLong(lead);
  assert.equal(proc.lines.length, 1);
  assert.match(proc.lines[0].message.content, /누적 29M 토큰.*인계.*새 관리자/s);

  const idle = { id: "I", name: "Gil", canSpawn: true, provider: "claude", status: "idle", usage: M(29) };
  const r = rt(null);
  const hub = fakeHub([idle], { I: r }, { handoffMTokens: 15 });
  hub.checkLong(idle);
  assert.match(r.longPending, /새 관리자/);
  assert.equal(hub.sentTo.length, 0, "an idle lead is not woken just for this");
});

test("checkLong: under the budget or guard off does nothing", () => {
  const s = { id: "a", parent: "L", provider: "claude", status: "running", usage: M(3) };
  const hub = fakeHub([s], { a: rt(fakeProc()) }, { handoffMTokens: 15 });
  hub.checkLong(s);
  assert.equal(s.longRun, undefined);
  s.usage = M(100);
  fakeHub([s], { a: rt(fakeProc()) }, { handoffMTokens: 0 }).checkLong(s);
  assert.equal(s.longRun, undefined);
});

test("attention: a long session shows a warning; real states and the context guard win", () => {
  const s = { longRun: { mtok: 18, sinceMs: 7 } };
  assert.deepEqual(attentionOf(s, "resting", 0, 1), { level: "warn", reason: "오래 쓴 세션이에요 (누적 18M 토큰). 새 세션으로 바꿔 주세요", since: 7 });
  assert.equal(attentionOf({ ...s, ctxHigh: { pct: 80, sinceMs: 2 } }, "working", 0, 1).reason, "컨텍스트를 80% 썼어요");
  assert.equal(attentionOf(s, "failed", 0, 1).reason, "오류로 멈췄어요");
  assert.equal(attentionOf(s, "done", 0, 1), null);
});

test("hook: does nothing outside Dispatch, notes once inside a long session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-hook-"));
  let calls = 0;
  const state = { sessions: [{ id: "k", parent: "L", longRun: { mtok: 16 } }, { id: "s", longRun: null }] };
  const fetchFn = async () => { calls++; return { ok: true, json: async () => state }; };
  assert.equal(await run({}, fetchFn, dir), null);
  assert.equal(await run({ DISPATCH_URL: "http://evil.example", DISPATCH_SESSION: "k" }, fetchFn, dir), null);
  assert.equal(calls, 0, "no request outside a local Dispatch session");
  const env = { DISPATCH_URL: "http://127.0.0.1:4319", DISPATCH_SESSION: "k" };
  const out = await run(env, fetchFn, dir);
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /누적 16M 토큰.*보고하고 턴을 끝내라/s);
  assert.equal(await run(env, fetchFn, dir), null, "only once per session");
  assert.equal(await run({ ...env, DISPATCH_SESSION: "s" }, fetchFn, dir), null, "a session under the guard gets nothing");
  assert.match(noteFor({ longRun: { mtok: 30 } }), /새 관리자/);
});
