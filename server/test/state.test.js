import { test } from "node:test";
import assert from "node:assert/strict";
import { asksUser, attentionOf, sessionState } from "../state.js";

test("asksUser: a final question or a request to decide", () => {
  assert.equal(asksUser("작업 끝났어요.\n\n배지 표시가 의도한 디자인인지 답해 주세요."), true);
  assert.equal(asksUser("두 가지 방법이 있어요.\n1. A\n2. B\n\n어느 쪽으로 할까요?"), true);
  assert.equal(asksUser("Should I push the branch?"), true);
  assert.equal(asksUser("**PR을 열까요?**"), true);
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
  assert.equal(sessionState({ status: "idle", asksUser: true }), "waiting");
  assert.equal(sessionState({ status: "idle", asksUser: true, parent: "lead" }), "resting");
  assert.equal(sessionState({ status: "idle", stuck: { reason: "x", since: 1 } }), "stuck");
  assert.equal(sessionState({ status: "error" }), "failed");
  assert.equal(sessionState({ status: "done" }), "done");
});

test("attentionOf", () => {
  assert.equal(attentionOf({ status: "idle" }, "resting"), null);
  assert.equal(attentionOf({ status: "running" }, "working"), null);
  assert.deepEqual(attentionOf({ status: "error" }, "failed", 0, 5), { level: "bad", reason: "오류로 멈췄어요", since: 5 });
  assert.equal(attentionOf({ status: "waiting" }, "waiting", 1).reason, "권한 승인을 기다려요");
  assert.equal(attentionOf({ status: "idle", asksUser: true }, "waiting").reason, "사용자 답을 기다려요");
  assert.equal(attentionOf({ status: "idle", stuck: { reason: "같은 테스트가 3번 실패했어요", since: 9 } }, "stuck").since, 9);
});
