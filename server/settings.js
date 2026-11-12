// Team settings a user changes from the 설정 page, saved per project in .dispatch/state.json.
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
  /** Default model per role id, overriding the built-in preset. */
  roleModels: {},
  /**
   * Context guard, in percent of the model's context window (0 = off). A Claude session that crosses it
   * mid-turn is told once to commit and wrap up; any session over it continues in a fresh CLI session at
   * its next message, whatever its turn count. Turn-count rotation alone missed a session that grew
   * inside one long turn while its lead kept sending follow-ups.
   */
  ctxHandoff: envNum("DISPATCH_CTX_HANDOFF", 70),
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
  if ("maxChildren" in patch) next.maxChildren = int(patch.maxChildren, 1, 16);
  if ("stuckFails" in patch) next.stuckFails = int(patch.stuckFails, 0, 20);
  if ("stuckSilentMinutes" in patch) next.stuckSilentMinutes = int(patch.stuckSilentMinutes, 0, 240);
  if ("stuckMismatchMinutes" in patch) next.stuckMismatchMinutes = int(patch.stuckMismatchMinutes, 0, 240);
  if ("stuckEtaRatio" in patch) next.stuckEtaRatio = ratio(patch.stuckEtaRatio, 1, 10);
  for (const k of ["replyStyle", "shareDeps", "dropWorktrees"]) if (k in patch) next[k] = patch[k] === true;
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

/** Roles as the UI and the lead see them: preset defaults with the user's model overrides. */
export function effectiveRoles(roles, store) {
  const rm = teamSettings(store).roleModels;
  return roles.map(r => (rm[r.id] ? { ...r, model: rm[r.id] } : r));
}
