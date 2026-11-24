// #1052: AskUserQuestion answers go back in the permission response's updatedInput.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanAnswers, permissionResponse } from "../../server/dispatch/permission-response.js";

const input = { questions: [{ question: "어느 쪽?", options: [{ label: "A" }, { label: "B" }] }, { question: "기능?", multiSelect: true, options: [] }] };

test("allow keeps the input; deny says why", () => {
  assert.deepEqual(permissionResponse({ tool: "Bash", input: { command: "ls" }, suggestions: [] }, "allow"), { behavior: "allow", updatedInput: { command: "ls" } });
  assert.equal(permissionResponse({ tool: "Bash", input: {} }, "deny").behavior, "deny");
  assert.deepEqual(permissionResponse({ tool: "Bash", input: {}, suggestions: [{ x: 1 }] }, "allow", { always: true }).updatedPermissions, [{ x: 1 }]);
});

test("AskUserQuestion: answers ride in updatedInput, keyed by asked questions only", () => {
  const r = permissionResponse({ tool: "AskUserQuestion", input }, "allow", { answers: { "어느 쪽?": "A", "기능?": " X, Y ", "딴 질문": "Z" } });
  assert.deepEqual(r.updatedInput, { ...input, answers: { "어느 쪽?": "A", "기능?": "X, Y" } });
  // Other tools never take answers.
  assert.deepEqual(permissionResponse({ tool: "Bash", input: { command: "ls" } }, "allow", { answers: { a: "b" } }).updatedInput, { command: "ls" });
  assert.equal(cleanAnswers(input, ["A"]), null);
  assert.equal(cleanAnswers(input, { "어느 쪽?": "" }), null);
});
