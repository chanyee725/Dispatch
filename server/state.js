import { createHash } from "node:crypto";

// What a session needs from a person, decided on the server so every view (cards, sheet, the
// attention strip, sorting) reads the same answer instead of re-deriving it from `status`.
//
//   working  — a turn is running
//   waiting  — a person has to act: a permission prompt, or a top-level session ended its turn asking the user
//   stuck    — looks stuck (set by the per-session stuck check; s.stuck = { reason, label, count?, sinceMs })
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
    case "stuck": return { level: "warn", reason: s.stuck?.label || "멈춘 것 같아요", since: s.stuck?.sinceMs ?? since };
    default: return null;
  }
}

/* ---------------- Stuck detection ----------------
 * Per-session and per-task signals that work is going nowhere. Only a hash of the normalised command
 * and counts are kept: command text and output never leave the transcript (the org forbids storing them).
 *
 *   repeat-fail     the same check command (test, build, lint, typecheck, e2e) failed N times in a row
 *   silent          running, but no output or tool event for N minutes
 *   over-eta        a task's stage has run past ratio × its eta
 *   stage-mismatch  the board says plan/impl while the owner is looping on tests
 */

// Commands worth counting: checks, where "same command fails again" means a loop, not exploration.
const CHECK = /\b(playwright|vitest|jest|pytest|mocha|tsc|eslint|typecheck)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|typecheck|e2e)\b|\bnode\s+--test\b|\b(cargo|go)\s+(test|build)\b|\bmake\s+(test|check|build)\b|\b(vite|next)\s+build\b|\b(gradlew?|mvn)\b/;

/**
 * One command line reduced to what decides "the same command": shell wrappers, `cd` steps, env
 * assignments, redirections and output filters (`| tail`) are dropped, whitespace collapsed.
 */
export function normalizeCommand(cmd) {
  let t = String(cmd ?? "").trim();
  const wrapped = t.match(/^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/);
  if (wrapped) t = wrapped[2];
  return t.split(/\s*(?:&&|\|\||;)\s*/)
    .map(seg => seg.split(/\s*\|\s*/)[0]
      .replace(/\s*\d?>>?\s*(&\d|\/dev\/null|\S+)/g, "")
      .replace(/^(\w+=\S*\s+)+/, "")
      .replace(/\s+/g, " ").trim())
    .filter(seg => seg && !/^(cd|pushd|export|set|source|\.)\b/.test(seg))
    .join(" && ");
}

/** A short hash identifying a check command, or null when the command is not a check. */
export function checkKey(cmd) {
  const n = normalizeCommand(cmd);
  if (!n || !CHECK.test(n)) return null;
  return createHash("sha256").update(n).digest("hex").slice(0, 12);
}

/**
 * Counts consecutive failures per check key in `fails` (a Map). A pass clears that key.
 * Returns the key's record after the update, or null after a pass.
 */
export function recordCheck(fails, key, ok, now, kind = null) {
  if (ok) { fails.delete(key); return null; }
  const f = fails.get(key) || { count: 0, firstAt: now, kind };
  f.count += 1;
  f.lastAt = now;
  if (kind) f.kind = kind;
  fails.delete(key); fails.set(key, f); // newest last
  while (fails.size > 32) fails.delete(fails.keys().next().value);
  return f;
}

const SUBJECT = { "e2e 실행": "e2e가", "단위 테스트": "테스트가", "타입 검사": "타입 검사가", lint: "lint가", "빌드": "빌드가" };
const subject = kind => SUBJECT[kind] || "같은 검사 명령이";
const TEST_KINDS = new Set(["e2e 실행", "단위 테스트"]);
const STAGE_KO = { plan: "계획", impl: "구현", review: "리뷰", test: "테스트", merge: "병합", blocked: "막힘" };

/**
 * A session's stuck flag from its runtime counters, or null.
 * `rt` is `{ fails: Map, lastEventAt }`; `cfg` the team settings.
 */
export function sessionStuck(s, rt, now, cfg) {
  if (!["running", "starting", "waiting", "idle"].includes(s.status)) return null;
  let worst = null;
  if (cfg.stuckFails > 0) for (const [key, f] of rt.fails || []) if (f.count >= cfg.stuckFails && (!worst || f.count >= worst.count)) worst = { key, ...f };
  if (worst) {
    return { reason: "repeat-fail", label: `${subject(worst.kind)} ${worst.count}번 연속 실패했어요`,
      count: worst.count, key: worst.key, kind: worst.kind ?? null, sinceMs: worst.firstAt };
  }
  const silentMs = cfg.stuckSilentMinutes * 60_000;
  if (s.status === "running" && silentMs > 0 && rt.lastEventAt != null && now - rt.lastEventAt >= silentMs) {
    return { reason: "silent", label: `${cfg.stuckSilentMinutes}분 넘게 출력이 없어요`, sinceMs: rt.lastEventAt };
  }
  return null;
}

/**
 * A task's stuck flag, or null. `owner` is the owning session (or null) and `activity` its live
 * `{ label, since }` while a turn runs.
 */
export function taskStuck(t, owner, activity, now, cfg) {
  if (!t || t.stage === "done") return null;
  const early = t.stage === "plan" || t.stage === "impl";
  const ko = STAGE_KO[t.stage] || t.stage;
  if (early && owner?.stuck?.reason === "repeat-fail" && TEST_KINDS.has(owner.stuck.kind)) {
    const what = owner.stuck.kind === "e2e 실행" ? "e2e" : "테스트";
    return { reason: "stage-mismatch", label: `보드는 ${ko}인데 실제로는 ${what} 실패가 반복돼요`,
      stage: t.stage, activity: owner.stuck.kind, count: owner.stuck.count, sinceMs: owner.stuck.sinceMs };
  }
  const mismatchMs = cfg.stuckMismatchMinutes * 60_000;
  if (early && mismatchMs > 0 && activity && TEST_KINDS.has(activity.label) && now - activity.since >= mismatchMs) {
    return { reason: "stage-mismatch", label: `보드는 ${ko}인데 ${cfg.stuckMismatchMinutes}분 넘게 ${activity.label} 중이에요`,
      stage: t.stage, activity: activity.label, sinceMs: activity.since };
  }
  if (t.etaAt && cfg.stuckEtaRatio > 0) {
    const base = t.etaSetAt ?? t.stageAt ?? t.createdAt;
    const planned = t.etaAt - base;
    const at = base + planned * cfg.stuckEtaRatio;
    if (planned > 0 && now >= at) {
      return { reason: "over-eta", label: `예상 ${Math.max(1, Math.round(planned / 60_000))}분의 ${cfg.stuckEtaRatio}배를 넘겼어요`,
        stage: t.stage, etaMinutes: Math.round(planned / 60_000), sinceMs: Math.round(at) };
    }
  }
  return null;
}

/** Identity of a flag for de-duplication: a new event only when this changes, not on every count. */
export const stuckSig = st => (st ? `${st.reason}|${st.key ?? ""}|${st.stage ?? ""}|${st.activity ?? ""}` : "");
