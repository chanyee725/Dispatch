// What a session needs from a person, decided on the server so every view (cards, sheet, the
// attention strip, sorting) reads the same answer instead of re-deriving it from `status`.
//
//   working  — a turn is running
//   waiting  — a person has to act: a permission prompt, or a top-level session ended its turn asking the user
//   stuck    — looks stuck (set by the per-session stall check; s.stuck = { reason, since })
//   failed   — the last turn ended in an error
//   resting  — turn finished, nothing asked; waiting for the next instruction
//   done     — closed
export const STATES = ["working", "waiting", "stuck", "failed", "resting", "done"];

// Phrases that end a turn by handing a decision to the reader. Checked against the last few lines only,
// so a question quoted mid-answer does not count.
const ASK = /(\?|？)\s*$|(할까요|될까요|일까요|을까요|좋을까요|괜찮을까요|습니까|원하세요|주실래요|주시겠어요|답해\s?주세요|알려\s?주세요|골라\s?주세요|정해\s?주세요|선택해\s?주세요|결정해\s?주세요|승인해\s?주세요)[.!…\s]*$/;

/** True when a final answer ends by asking its reader something. */
export function asksUser(text) {
  if (!text) return false;
  const lines = String(text).split("\n").map(l => l.replace(/[*_`>#\s]+$/g, "").replace(/^[\s>*#-]+/, "").trim()).filter(Boolean);
  return lines.slice(-3).some(l => ASK.test(l));
}

/**
 * A session's monitoring state. `pending` is the number of open permission prompts.
 * Only a session without a lead asks *the user*: a teammate's question goes to its lead.
 */
export function sessionState(s, pending = 0) {
  if (s.status === "done") return "done";
  if (s.status === "error") return "failed";
  if (pending > 0 || s.status === "waiting") return "waiting";
  if (s.stuck) return "stuck";
  if (s.status === "running" || s.status === "starting") return "working";
  if (s.asksUser && !s.parent) return "waiting";
  return "resting";
}

/** Why a person should look, or null when nothing is needed. `level` maps to the --bad / --warn colours. */
export function attentionOf(s, state, pending = 0, since = null) {
  switch (state) {
    case "failed": return { level: "bad", reason: "오류로 멈췄어요", since };
    case "waiting": return { level: "warn", reason: pending > 0 || s.status === "waiting" ? "권한 승인을 기다려요" : "사용자 답을 기다려요", since };
    case "stuck": return { level: "warn", reason: s.stuck?.reason || "멈춘 것 같아요", since: s.stuck?.since ?? since };
    default: return null;
  }
}
