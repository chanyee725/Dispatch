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
import { askIndex, linesOf } from "../shared/ask.js";

export const STATES = ["working", "waiting", "stuck", "failed", "resting", "done"];

/** True when a final answer ends by asking its reader something (see shared/ask.js). */
export function asksUser(text) {
  if (!text) return false;
  return askIndex(linesOf(text)) >= 0;
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

/** Share of the context window in use (0–1), or null when the window is unknown. */
export function ctxShare(s) {
  return s?.ctxWindow > 0 && s.ctx >= 0 ? s.ctx / s.ctxWindow : null;
}

/** True when the session is at or over the team's context guard (`ctxHandoff`, percent; 0 = off). */
export function ctxOver(s, cfg) {
  const pct = cfg?.ctxHandoff ?? 0;
  const share = ctxShare(s);
  return pct > 0 && share != null && share * 100 >= pct;
}

/** Tokens the session has processed in total, in millions (input + cache read + cache write + output). */
export function mtokens(s) {
  const u = s?.usage || {};
  return ((u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) + (u.output || 0)) / 1e6;
}

/** True when the session is at or over the team's length guard (`handoffMTokens`, millions; 0 = off). */
export function longOver(s, cfg) {
  const m = cfg?.handoffMTokens ?? 0;
  return m > 0 && mtokens(s) >= m;
}

/** Why a person should look, or null when nothing is needed. `level` maps to the --bad / --warn colours. */
export function attentionOf(s, state, pending = 0, since = null) {
  switch (state) {
    case "failed": return { level: "bad", reason: "오류로 멈췄어요", since };
    case "waiting": return { level: "warn", reason: pending > 0 || s.status === "waiting" ? "권한 승인을 기다려요" : "사용자 답을 기다려요", since };
    case "stuck": return { level: "warn", reason: s.stuck?.label || "멈춘 것 같아요", since: s.stuck?.sinceMs ?? since };
    default:
      // Over the context guard: not stuck, but the next message starts a fresh CLI session.
      if (s.ctxHigh && state !== "done") return { level: "warn", reason: `컨텍스트를 ${s.ctxHigh.pct}% 썼어요`, since: s.ctxHigh.sinceMs ?? since };
      // Over the length guard: the session should be replaced by a fresh one.
      if (s.longRun && state !== "done") return { level: "warn", reason: `오래 쓴 세션이에요 (누적 ${s.longRun.mtok}M 토큰). 새 세션으로 바꿔 주세요`, since: s.longRun.sinceMs ?? since };
      return null;
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

const unwrap = cmd => {
  const t = String(cmd ?? "").trim();
  const wrapped = t.match(/^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/);
  return wrapped ? wrapped[2] : t;
};

/**
 * True when the exit code doesn't say whether the check passed: a pipe (`npm test | tail`) reports
 * the last stage's code unless `set -o pipefail` is on, and `npm test || true` always exits 0.
 * Quoted text (`grep "a|b"`) doesn't count.
 */
export function exitUnclear(cmd) {
  const t = unwrap(cmd).replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");
  if (t.includes("||")) return true;
  return /\|/.test(t) && !/\bset\s+(-\w+\s+)*-o\s+pipefail\b|\bset\s+-\w*o\s+pipefail\b/.test(t);
}

/**
 * One command line reduced to what decides "the same command": shell wrappers, env assignments,
 * redirections and output filters (`| tail`) are dropped, whitespace collapsed. `cd` steps stay, so
 * the same command in another directory is another command.
 */
export function normalizeCommand(cmd) {
  return unwrap(cmd).split(/\s*(?:&&|\|\||;)\s*/)
    .map(seg => seg.split(/\s*\|\s*/)[0]
      .replace(/\s*\d?>>?\s*(&\d|\/dev\/null|\S+)/g, "")
      .replace(/^(\w+=\S*\s+)+/, "")
      .replace(/\s+/g, " ").trim())
    .filter(seg => seg && !/^(export|set|source|\.)\b/.test(seg))
    .join(" && ");
}

/**
 * A short hash identifying a check command, or null when the command is not a check or its result
 * can't be judged from the exit code (a pipe without pipefail) — then the counter is left alone.
 */
export function checkKey(cmd) {
  if (exitUnclear(cmd)) return null;
  const n = normalizeCommand(cmd);
  if (!n || !CHECK.test(n)) return null;
  return createHash("sha256").update(n).digest("hex").slice(0, 12);
}

/**
 * Counts consecutive failures per check key in `fails` (a Map). A pass clears that key and every
 * failing key of the same kind (a passing `npm test -- a.spec` means the test loop moved on).
 * Returns the key's record after the update, or null after a pass.
 */
export function recordCheck(fails, key, ok, now, kind = null) {
  if (ok) {
    fails.delete(key);
    if (kind) for (const [k, f] of fails) if (f.kind === kind) fails.delete(k);
    return null;
  }
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
  const mismatchMs = cfg.stuckMismatchMinutes * 60_000;
  if (early && mismatchMs > 0 && owner?.stuck?.reason === "repeat-fail" && TEST_KINDS.has(owner.stuck.kind)) {
    const what = owner.stuck.kind === "e2e 실행" ? "e2e" : "테스트";
    return { reason: "stage-mismatch", label: `보드는 ${ko}인데 실제로는 ${what} 실패가 반복돼요`,
      stage: t.stage, activity: owner.stuck.kind, count: owner.stuck.count, sinceMs: owner.stuck.sinceMs };
  }
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
