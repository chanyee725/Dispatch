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
});

export function teamSettings(store) {
  return { ...TEAM_DEFAULTS(), ...(store.data.settings.team || {}) };
}

const int = (v, min, max) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw Object.assign(new Error(`${min}~${max} 사이 숫자를 넣어 주세요`), { status: 400 });
  return n;
};

/** Validates a partial update from the UI; unknown keys are ignored. */
export function patchTeam(store, patch, { roles, models }) {
  const cur = store.data.settings.team || {};
  const next = { ...cur };
  if ("rotateLead" in patch) next.rotateLead = int(patch.rotateLead, 0, 100);
  if ("rotateOthers" in patch) next.rotateOthers = int(patch.rotateOthers, 0, 100);
  if ("maxChildren" in patch) next.maxChildren = int(patch.maxChildren, 1, 16);
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
