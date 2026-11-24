import { staticModels } from "./models.js";

// Team settings a user changes from the 설정 page, saved per project in .atelier/state.json.
// Environment variables still seed the defaults, so existing setups keep working until changed.

const envNum = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" || Number.isNaN(Number(v)) ? fallback : Number(v);
};

export const TEAM_DEFAULTS = () => ({
  /** A lead continues in a fresh CLI session after this many turns (0 = never). */
  rotateLead: envNum("DISPATCH_ROTATE_TURNS_LEAD", 5),
  /** Same for every other role. */
  rotateOthers: envNum("DISPATCH_ROTATE_TURNS", 10),
  /** Open teammates one lead may hold at once. */
  maxChildren: 8,
  /** Append the reply-style guide to every session's prompt. */
  replyStyle: process.env.DISPATCH_REPLY_STYLE !== "off",
  /** Give a new worktree the project's node_modules as hard links. */
  shareDeps: true,
  /** Remove a session's worktree with it when nothing uncommitted is left. */
  dropWorktrees: true,
  /**
   * Remove a teammate (any session with a lead, never a lead) once its turn ended, its report reached the
   * lead and nothing waits on a person, unless the lead writes to it within `autoRemoveGraceSec`. Leads
   * forgot stop_session(remove: true) and finished teammates piled up (Dispatch issue #39, Drawing #632).
   */
  autoRemoveDone: true,
  /** Grace period before that removal, in seconds. */
  autoRemoveGraceSec: 120,
  /** Default model per role id, overriding the built-in preset. */
  roleModels: {},
  /**
   * Context guard, in percent of the model's context window (0 = off). A Claude session that crosses it
   * mid-turn is told once to commit and wrap up; any session over it continues in a fresh CLI session at
   * its next message, whatever its turn count. Turn-count rotation alone missed a session that grew
   * inside one long turn while its lead kept sending follow-ups.
   */
  ctxHandoff: envNum("DISPATCH_CTX_HANDOFF", 70),
  /**
   * Session length guard, in millions of tokens the session has processed in total (input + cache read +
   * cache write + output; 0 = off). Turn rotation keeps each call's context small, but a session that runs
   * for hundreds of turns still re-reads its work every call: one lead reached 29M tokens. Past this budget a
   * teammate's lead is told once to replace it with a fresh teammate, and a lead is told to hand over.
   */
  handoffMTokens: envNum("DISPATCH_HANDOFF_MTOKENS", 15),
  /**
   * Past `handoffMTokens`, swap the session for a fresh one with the same role, model, effort, perm and folder once
   * it is between turns (#969): a lead hands over to its successor (teammates and board move with it), a teammate
   * is swapped on its next turn when its lead did not replace it. Off: only the notices above.
   */
  autoRotateLong: true,
  /** Stuck detection: the same check command failing this many times in a row (0 = off). */
  stuckFails: 3,
  /** A running session with no output or tool event for this many minutes (0 = off). */
  stuckSilentMinutes: 10,
  /** A task stage running past this multiple of its eta (0 = off). */
  stuckEtaRatio: 1.5,
  /** Board says plan/impl while the owner has been running tests this many minutes (0 = off). */
  stuckMismatchMinutes: 10,
});

export function teamSettings(store) {
  return { ...TEAM_DEFAULTS(), ...(store.data.settings.team || {}) };
}

const int = (v, min, max) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw Object.assign(new Error(`${min}~${max} 사이 숫자를 넣어 주세요`), { status: 400 });
  return n;
};

const ratio = (v, min, max) => {
  const n = Math.round(Number(v) * 10) / 10;
  if (!Number.isFinite(n) || (n !== 0 && (n < min || n > max))) throw Object.assign(new Error(`0 또는 ${min}~${max} 사이 숫자를 넣어 주세요`), { status: 400 });
  return n;
};

/** Validates a partial update from the UI; unknown keys are ignored. */
export function patchTeam(store, patch, { roles, models }) {
  const cur = store.data.settings.team || {};
  const next = { ...cur };
  if ("rotateLead" in patch) next.rotateLead = int(patch.rotateLead, 0, 100);
  if ("rotateOthers" in patch) next.rotateOthers = int(patch.rotateOthers, 0, 100);
  if ("ctxHandoff" in patch) {
    const n = int(patch.ctxHandoff, 0, 95);
    if (n !== 0 && n < 30) throw Object.assign(new Error("0 또는 30~95 사이 숫자를 넣어 주세요"), { status: 400 });
    next.ctxHandoff = n;
  }
  if ("handoffMTokens" in patch) {
    const n = int(patch.handoffMTokens, 0, 500);
    if (n !== 0 && n < 2) throw Object.assign(new Error("0 또는 2~500 사이 숫자를 넣어 주세요"), { status: 400 });
    next.handoffMTokens = n;
  }
  if ("autoRemoveGraceSec" in patch) next.autoRemoveGraceSec = int(patch.autoRemoveGraceSec, 3, 3600);
  if ("maxChildren" in patch) next.maxChildren = int(patch.maxChildren, 1, 16);
  if ("stuckFails" in patch) next.stuckFails = int(patch.stuckFails, 0, 20);
  if ("stuckSilentMinutes" in patch) next.stuckSilentMinutes = int(patch.stuckSilentMinutes, 0, 240);
  if ("stuckMismatchMinutes" in patch) next.stuckMismatchMinutes = int(patch.stuckMismatchMinutes, 0, 240);
  if ("stuckEtaRatio" in patch) next.stuckEtaRatio = ratio(patch.stuckEtaRatio, 1, 10);
  for (const k of ["replyStyle", "shareDeps", "dropWorktrees", "autoRemoveDone", "autoRotateLong"]) if (k in patch) next[k] = patch[k] === true;
  if (patch.roleModels && typeof patch.roleModels === "object") {
    const rm = { ...(cur.roleModels || {}) };
    for (const [role, model] of Object.entries(patch.roleModels)) {
      if (!roles.some(r => r.id === role)) continue;
      if (model === null || model === "") { delete rm[role]; continue; }
      if (!models.some(m => m.id === model)) throw Object.assign(new Error(`알 수 없는 모델: ${model}`), { status: 400 });
      rm[role] = model;
    }
    next.roleModels = rm;
  }
  store.data.settings.team = next;
  return teamSettings(store);
}

/**
 * Roles as the UI and the lead see them: preset defaults with the user's model overrides. Overrides
 * naming a model that is not offered (not in the list, or Codex models before Codex connects) are ignored.
 */
export function effectiveRoles(roles, store, models = staticModels()) {
  const rm = teamSettings(store).roleModels;
  return roles.map(r => (rm[r.id] && models.some(m => m.id === rm[r.id]) ? { ...r, model: rm[r.id] } : r));
}

/**
 * Usage-limit guard thresholds per provider, as fractions. The top-level `five`/`seven`/`fable` stay Claude's (as
 * standalone Dispatch stores them, so saved settings keep working); `openai` holds Codex's own thresholds for its
 * short (primary, 5시간) and weekly (secondary) windows. Gemini only reports whether its quota was hit, so it has no
 * threshold: a reached quota holds new Gemini turns until it resets.
 */
export const GUARD_DEFAULTS = Object.freeze({ five: 0.9, seven: 0.85, fable: 0.85, openai: Object.freeze({ five: 0.9, seven: 0.85 }) });

/** Codex thresholds from saved guard settings, defaults filled in. */
export const codexGuard = guard => ({ ...GUARD_DEFAULTS.openai, ...(guard?.openai && typeof guard.openai === "object" ? guard.openai : {}) });

const fraction = v => {
  const n = Math.round(Number(v) * 100) / 100;
  if (v === "" || v === true || v === null || !Number.isFinite(n) || n < 0.01 || n > 1) throw Object.assign(new Error("1~100 사이 숫자를 넣어 주세요"), { status: 400 });
  return n;
};

/**
 * Validates a usage-limit guard update (fractions 0.01..1; unknown keys, including `enabled`, are ignored, so the
 * guard cannot be switched off from the UI). `fable: null` falls back to the weekly value. `openai: { five, seven }`
 * sets Codex's thresholds.
 */
export function patchGuard(cur, patch) {
  const next = { ...cur };
  for (const k of ["five", "seven", "fable"]) {
    if (!(k in patch)) continue;
    if (k === "fable" && patch[k] === null) { delete next.fable; continue; }
    next[k] = fraction(patch[k]);
  }
  if (patch.openai && typeof patch.openai === "object") {
    const o = { ...(cur.openai || {}) };
    for (const k of ["five", "seven"]) if (k in patch.openai) o[k] = fraction(patch.openai[k]);
    next.openai = o;
  }
  return next;
}
