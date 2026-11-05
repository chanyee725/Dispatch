import { test } from "node:test";
import assert from "node:assert/strict";
import { questionOf } from "../src/lib/question.ts";

test("no question → null", () => {
  assert.equal(questionOf("테스트를 모두 통과했어요."), null);
  assert.equal(questionOf(""), null);
  assert.equal(questionOf(null), null);
});

test("a question quoted mid-answer does not count", () => {
  assert.equal(questionOf("왜 실패했을까요?\n원인을 찾았어요.\n고쳤어요.\n커밋했어요."), null);
});

test("yes/no ask gets yes/no options", () => {
  const q = questionOf("브랜치를 만들었어요.\n**이대로 병합할까요?**");
  assert.deepEqual(q, { summary: "이대로 병합할까요?", options: ["네, 진행해 주세요", "아니요, 멈춰 주세요"] });
});

test("open question gets no options", () => {
  assert.deepEqual(questionOf("어떤 이름으로 할까요?")?.options, []);
});

test("list after the question becomes options", () => {
  const q = questionOf("어느 쪽으로 갈까요?\n1. **A안** — 빠르지만 거칠어요\n2. B안: 느리지만 안전해요\n3) C안");
  assert.equal(q?.summary, "어느 쪽으로 갈까요?");
  assert.deepEqual(q?.options, ["A안", "B안", "C안"]);
});

test("list before the question becomes options", () => {
  const q = questionOf("선택지는 이래요.\n- Redis 캐시\n- 메모리 캐시\n둘 중 무엇을 쓸까요?");
  assert.deepEqual(q?.options, ["Redis 캐시", "메모리 캐시"]);
});

test("options are capped at five", () => {
  const q = questionOf("어느 걸 고를까요?\n" + [1, 2, 3, 4, 5, 6, 7].map(n => `${n}. 옵션${n}`).join("\n"));
  assert.equal(q?.options.length, 5);
});
