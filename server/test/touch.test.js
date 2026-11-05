import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub } from "../sessions.js";

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
  rt.lastText = null;                              // reportToParent() clears it
  hub.touch(s, { status: "idle" });               // process exits
  assert.equal(s.asksUser, true);
  assert.equal(hub.publicSession(s).state, "waiting");
  hub.touch(s, { status: "running" });            // next turn
  assert.equal(s.asksUser, false);
});
