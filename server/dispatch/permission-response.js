// The control_response body for a Claude permission prompt (#1052). For AskUserQuestion, `answers`
// ({ "<question text>": "<label>, <label>" }) rides in updatedInput so the tool returns the person's
// choices instead of asking again. Pure, so it runs under `node --test`.

const QUESTION_TOOLS = new Set(["AskUserQuestion", "ask_user", "askUserQuestion"]);

/** Answers keyed by a question text of this prompt, values as trimmed strings; null when none fit. */
export function cleanAnswers(input, answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  const asked = new Set((Array.isArray(input?.questions) ? input.questions : []).map(q => q?.question).filter(q => typeof q === "string"));
  const out = {};
  for (const [q, a] of Object.entries(answers)) {
    if (asked.has(q) && typeof a === "string" && a.trim()) out[q] = a.trim().slice(0, 2000);
  }
  return Object.keys(out).length ? out : null;
}

/** `req`: { tool, input, suggestions }. Returns the `response` object of a control_response. */
export function permissionResponse(req, behavior, { always = false, answers = null } = {}) {
  if (behavior !== "allow") return { behavior: "deny", message: "사용자가 Dispatch에서 거부했어요" };
  const picked = QUESTION_TOOLS.has(req.tool) ? cleanAnswers(req.input, answers) : null;
  return {
    behavior: "allow",
    updatedInput: picked ? { ...req.input, answers: picked } : req.input,
    ...(always && req.suggestions?.length ? { updatedPermissions: req.suggestions } : {}),
  };
}
