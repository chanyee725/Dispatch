import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub } from "../../server/dispatch/hub.js";
import { questionOf } from "../../web/src/dispatch/lib/question.ts";

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

test("an idle lead follows working teammate transitions without a person alert", () => {
  const lead = session({ id: "lead", canSpawn: true, status: "running" });
  const first = session({ id: "first", parent: lead.id, name: "Jae", status: "running" });
  const second = session({ id: "second", parent: lead.id, name: "Bo" });
  const { hub, events } = fakeHub([lead, first, second]);
  const sentLead = () => events.filter(([ev, data]) => ev === "session" && data.id === lead.id).at(-1)?.[1];

  hub.rt(lead.id).lastText = "다음:\n- 결과가 올라오면 다시 확인할까요?";
  hub.touch(lead, { status: "idle" });
  assert.equal(sentLead().state, "waiting-teammate");
  assert.equal(sentLead().waitingTeammate, "Jae");
  assert.equal(sentLead().attention, null);
  assert.equal(lead.asksUser, false);

  hub.touch(second, { status: "starting" });
  assert.equal(sentLead().state, "waiting-teammate");
  assert.equal(sentLead().waitingTeammate, null);
  hub.touch(first, { status: "idle" });
  assert.equal(sentLead().waitingTeammate, "Bo");
  hub.touch(second, { status: "done" });
  assert.equal(sentLead().state, "resting");
  assert.deepEqual(lead.history.map(([, state]) => state), ["waiting-teammate", "resting"]);
});

test("a lead's explicit question or permission prompt takes priority over teammate waiting", () => {
  const lead = session({ id: "lead", canSpawn: true, status: "running" });
  const child = session({ id: "child", parent: lead.id, status: "running" });
  const { hub } = fakeHub([lead, child]);
  const rt = hub.rt(lead.id);
  rt.lastText = "질문 1/2: 어느 쪽으로 갈까요?\n1. A안\n2. B안";
  hub.touch(lead, { status: "idle" });
  assert.equal(hub.publicSession(lead).state, "waiting");
  assert.match(hub.publicSession(lead).attention.reason, /어느 쪽으로 갈까요\?/);

  hub.touch(lead, { status: "running" });
  for (const tool of ["Bash", "AskUserQuestion"]) {
    rt.perms.set("request", { requestId: "request", tool });
    hub.touch(lead, { status: "waiting" });
    const current = hub.publicSession(lead);
    assert.equal(current.state, "waiting");
    assert.equal(current.pending[0].tool, tool);
    assert.equal(current.attention.reason, "권한 승인을 기다려요");
    rt.perms.clear();
  }
});

for (const { name, text, expected } of [
  {
    name: "a next-step question with numbered choices waits for a person",
    text: "다음 단계: 어느 환경에서 빌드할까요?\n1. 격리 환경\n2. 개발 환경",
    expected: {
      state: "waiting",
      ask: "다음 단계: 어느 환경에서 빌드할까요?",
      question: { summary: "다음 단계: 어느 환경에서 빌드할까요?", options: ["격리 환경", "개발 환경"] },
    },
  },
  {
    name: "a Markdown status heading with a question in its task list waits for the teammate",
    text: "## 남은 작업\n- 테스트 결과가 같은지 확인할까요?",
    expected: { state: "waiting-teammate", ask: null, question: null },
  },
]) {
  test(name, () => {
    const lead = session({ id: "lead", canSpawn: true, status: "running" });
    const child = session({ id: "child", parent: lead.id, status: "running" });
    const { hub } = fakeHub([lead, child]);
    hub.rt(lead.id).lastText = text;
    hub.touch(lead, { status: "idle" });

    const { state, ask } = hub.publicSession(lead);
    assert.deepEqual({ state, ask, question: questionOf(text) }, expected);
  });
}

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
