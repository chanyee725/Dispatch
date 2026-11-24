import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub } from "../../server/dispatch/hub.js";

// /api/state and the `session` SSE event both go through publicSession; the timeline history
// is served only by GET /api/timeline and must stay out of both.
function fakeHub(sessions) {
  const events = [];
  const hub = Object.assign(Object.create(Hub.prototype), {
    live: new Map(),
    store: { data: { sessions: Object.fromEntries(sessions.map(s => [s.id, s])), settings: {}, tasks: {} }, save() {}, addDaily() {} },
  });
  hub.emit = (ev, d) => { events.push([ev, d]); return true; };
  return { hub, events };
}

const session = (over = {}) => ({ id: "a", name: "s", status: "idle", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, turns: 0, updatedAt: 0, ...over });

test("publicSession: leaves out the state history it records", () => {
  const s = session({ history: [[1, "working"]] });
  const { hub } = fakeHub([s]);
  const pub = hub.publicSession(s);
  assert.equal("history" in pub, false);
  assert.ok(s.history.length >= 1, "history is still kept on the stored session");
});

test("session event: payload carries no history", () => {
  const s = session();
  const { hub, events } = fakeHub([s]);
  hub.mark(s, { status: "running" });
  const sent = events.filter(([ev]) => ev === "session");
  assert.ok(sent.length >= 1);
  for (const [, d] of sent) assert.equal("history" in d, false);
  assert.ok(hub.timeline().sessions.a.length >= 1, "history is served by the timeline instead");
});

test("setSessionTask: one line of at most 80 characters on the session; empty clears it (#912)", () => {
  const s = session();
  const { hub, events } = fakeHub([s]);
  hub.setSessionTask("a", "  로그인\n버튼 정리 " + "x".repeat(100));
  assert.equal(s.task.length, 80);
  assert.ok(s.task.startsWith("로그인 버튼 정리 x"));
  assert.equal(events.filter(([ev]) => ev === "session").at(-1)[1].task, s.task, "the session event carries it");
  hub.setSessionTask("a", "");
  assert.equal(s.task, null);
  assert.throws(() => hub.setSessionTask("nope", "x"), /세션이 없어요/);
});
