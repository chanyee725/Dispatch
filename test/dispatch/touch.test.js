import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub } from "../../server/dispatch/hub.js";

// A Hub stand-in with just what touch() reaches for.
function fakeHub(s, rt) {
  const live = new Map([[s.id, rt]]);
  return Object.assign(Object.create(Hub.prototype), {
    live, store: { data: { sessions: { [s.id]: s } }, save() {} },
  });
}

test("touch: a second idle after the report keeps the question (Codex/Gemini process exit)", () => {
  const s = { id: "a", status: "running", parent: null, updatedAt: 0 };
  const rt = { lastText: "어느 쪽으로 할까요?", perms: new Map() };
  const hub = fakeHub(s, rt);
  hub.touch(s, { status: "idle" });               // turn ends
  assert.equal(s.asksUser, true);
  assert.equal(s.ask, "어느 쪽으로 할까요?");
  rt.lastText = null;                              // reportToParent() clears it
  hub.touch(s, { status: "idle" });               // process exits
  assert.equal(s.asksUser, true);
  assert.equal(hub.publicSession(s).state, "waiting");
  hub.touch(s, { status: "running" });            // next turn
  assert.equal(s.asksUser, false);
});

test("touch: the question is read from this turn only and kept as ask (#886)", () => {
  const s = { id: "b", status: "running", parent: null, updatedAt: 0 };
  const rt = { lastText: `${"보고 ".repeat(300)}\n\n머지할까요?`, perms: new Map() };
  const hub = fakeHub(s, rt);
  hub.touch(s, { status: "idle" });
  // The question at the end of a long answer survives, though `last` keeps only the first 400 characters.
  assert.equal(s.ask, "머지할까요?");
  assert.equal(hub.publicSession(s).attention.reason, "답을 기다려요: 머지할까요?");
  hub.touch(s, { status: "running" });            // the user answers: a new turn
  assert.equal(rt.lastText, null);
  assert.equal(s.ask, null);
  hub.touch(s, { status: "idle" });               // the turn ends without any text
  assert.equal(s.asksUser, false);
  assert.equal(hub.publicSession(s).state, "resting");
});

test("touch: a permission approval mid-turn keeps the turn's text", () => {
  const s = { id: "c", status: "waiting", parent: null, updatedAt: 0 };
  const rt = { lastText: "이렇게 바꿀까요?", perms: new Map() };
  const hub = fakeHub(s, rt);
  hub.touch(s, { status: "running" });
  hub.touch(s, { status: "idle" });
  assert.equal(s.ask, "이렇게 바꿀까요?");
});

test("touch: a key cut at the ask's clip edge is masked, not left half-shown", () => {
  const s = { id: "d", status: "running", parent: null, updatedAt: 0 };
  // The key starts 10 characters before the 200-character clip, so clipping first would leave "sk-ABCDEF".
  const rt = { lastText: `${"가".repeat(190)}sk-ABCDEFGHIJKLMNOPQRST 로 할까요?`, perms: new Map() };
  const hub = fakeHub(s, rt);
  hub.touch(s, { status: "idle" });
  assert.equal(s.asksUser, true);
  assert.ok(!s.ask.includes("sk-A"), s.ask);
});
