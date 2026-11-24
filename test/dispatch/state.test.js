import { test } from "node:test";
import assert from "node:assert/strict";
import { askOf, asksUser, attentionOf, sessionState } from "../../server/dispatch/state.js";

test("asksUser: a final question or a request to decide", () => {
  assert.equal(asksUser("작업 끝났어요.\n\n배지 표시가 의도한 디자인인지 답해 주세요."), true);
  assert.equal(asksUser("두 가지 방법이 있어요.\n1. A\n2. B\n\n어느 쪽으로 할까요?"), true);
  assert.equal(asksUser("Should I push the branch?"), true);
  assert.equal(asksUser("**PR을 열까요?**"), true);
});

test("asksUser: a question followed by three or five choices still asks", () => {
  assert.equal(asksUser("어느 쪽으로 갈까요?\n1. A안\n2. B안\n3) C안"), true);
  assert.equal(asksUser("작업을 나눴어요.\n**어느 것부터 할까요?**\n- 하나\n- 둘\n- 셋\n- 넷\n- 다섯"), true);
  assert.equal(asksUser("바꾼 것:\n- 하나\n- 둘\n- 셋"), false);
  assert.equal(asksUser("왜 실패했을까요?\n원인을 찾았어요.\n고쳤어요.\n바꾼 것:\n- 하나\n- 둘\n- 셋"), false);
});

test("asksUser: a plain report is not a question", () => {
  assert.equal(asksUser("테스트 12개 통과했어요. 브랜치 feat/x 에 커밋했어요."), false);
  assert.equal(asksUser("다음 단계로 넘어가요."), false);
  assert.equal(asksUser("Q: 왜 실패했나?\n원인은 캐시였어요.\n고쳤어요.\n커밋했어요."), false);
  assert.equal(asksUser(""), false);
  assert.equal(asksUser(null), false);
});

test("sessionState", () => {
  assert.equal(sessionState({ status: "running" }), "working");
  assert.equal(sessionState({ status: "starting" }), "working");
  assert.equal(sessionState({ status: "waiting" }, 1), "waiting");
  assert.equal(sessionState({ status: "running" }, 1), "waiting");
  assert.equal(sessionState({ status: "idle" }), "resting");
  assert.equal(sessionState({ status: "idle", asksUser: true, ask: "어느 쪽으로 할까요?" }), "waiting");
  assert.equal(sessionState({ status: "idle", asksUser: true, ask: "어느 쪽으로 할까요?", parent: "lead" }), "resting");
  // #886: the flag without a question to show (an older record) is not "waiting on the user".
  assert.equal(sessionState({ status: "idle", asksUser: true }), "resting");
  assert.equal(sessionState({ status: "idle", asksUser: true, ask: "" }), "resting");
  assert.equal(sessionState({ status: "idle", stuck: { reason: "silent", sinceMs: 1 } }), "stuck");
  assert.equal(sessionState({ status: "error" }), "failed");
  assert.equal(sessionState({ status: "done" }), "done");
});

test("attentionOf", () => {
  assert.equal(attentionOf({ status: "idle" }, "resting"), null);
  assert.equal(attentionOf({ status: "running" }, "working"), null);
  assert.deepEqual(attentionOf({ status: "error" }, "failed", 0, 5), { level: "bad", reason: "오류로 멈췄어요", since: 5 });
  assert.equal(attentionOf({ status: "waiting" }, "waiting", 1).reason, "권한 승인을 기다려요");
  assert.equal(attentionOf({ status: "idle", asksUser: true, ask: "PR을 열까요?" }, "waiting").reason, "답을 기다려요: PR을 열까요?");
  assert.equal(attentionOf({ status: "idle", asksUser: true }, "waiting").reason, "답을 기다려요(내용 없음) · 세션 열기");
  const stuck = attentionOf({ status: "idle", stuck: { reason: "repeat-fail", label: "e2e가 3번 연속 실패했어요", count: 3, sinceMs: 9 } }, "stuck");
  assert.deepEqual(stuck, { level: "warn", reason: "e2e가 3번 연속 실패했어요", since: 9 });
});

test("askOf: the asking line of a final answer (#886)", () => {
  assert.equal(askOf("작업 끝났어요.\n\n**PR을 열까요?**"), "PR을 열까요?");
  assert.equal(askOf("어느 쪽으로 갈까요?\n1. A안\n2. B안"), "어느 쪽으로 갈까요?");
  assert.equal(askOf("두 가지가 있어요:\n1. A로 할까요?\n2. B로 할까요?"), "두 가지가 있어요:");
  assert.equal(askOf(`${"긴 보고 ".repeat(200)}\n배포할까요?`), "배포할까요?");
  assert.equal(askOf("x".repeat(300) + "?").length, 200);
  assert.equal(askOf("테스트 통과했어요."), "");
  assert.equal(askOf(null), "");
});
