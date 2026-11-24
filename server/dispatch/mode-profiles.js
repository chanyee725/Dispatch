// Harness profiles per mode (issue #748): for each kind of work (mode) and each role, which provider CLI,
// model, effort and permission mode a new session runs with. The user's changes live in
// ~/.atelier/drawing.json under `modeProfiles` (only the cells and hints they changed); the built-in grid
// below follows the model strengths the user chose (issue #748 comment, 2026-11-19).
//
// Stored shape: { cells: { <mode>: { <role>: { provider, model, effort, perm } } }, hints: { <model id or provider>: text } }.
// Metadata only: never keys, tokens or names.
import { ROLES, PERMS } from "./roles.js";
import { checkEffort, checkPerm, PROVIDER_NAMES } from "./hub.js";
import { isObj } from "../../shared/is-obj.ts";

export const MODES = [
  { id: "plan", name: "계획/설계" },
  { id: "impl", name: "구현" },
  { id: "review", name: "리뷰·테스트" },
  { id: "docs", name: "문서" },
  { id: "quickfix", name: "빠른 수정" },
  { id: "research", name: "조사" },
];
export const MODE_IDS = MODES.map(m => m.id);
export const DEFAULT_MODE = "impl";
export const PROVIDERS = ["claude", "openai", "gemini"];
/** The CLI names users and leads write (`codex`, `agy`) map to the provider ids the hub uses. */
const PROVIDER_ALIASES = { claude: "claude", openai: "openai", codex: "openai", gemini: "gemini", agy: "gemini" };
export const HINT_MAX = 40;

/** What each model is good at, shown beside every cell. Keyed by model id, or by provider for a whole catalog (Codex). */
export const DEFAULT_HINTS = Object.freeze({
  "claude-fable-5-2": "복잡한 작업",
  "claude-fable-5-1": "복잡한 작업",
  "claude-opus-5-5": "구현·빠른 수정",
  "claude-sonnet-5-5": "관리·문서",
  "claude-haiku-5-5": "짧은 일",
  openai: "서치·자료 수집",
  gemini: "긴 문맥",
});

// A choice: { provider, model, effort?, perm? }. model null = the provider's first listed model (Codex's list
// is only known once it is connected). `cross: true` on a role's chain = skip a choice whose model is the
// implementer's in the same mode while another choice is left (review and test cross-check the implementer).
const C = (model, extra = {}) => ({ provider: "claude", model, ...extra });
const CODEX = { provider: "openai", model: null };
const FABLE = C("claude-fable-5-2");
const OPUS = C("claude-opus-5-5");
const SONNET = C("claude-sonnet-5-5");
const GEMINI = { provider: "gemini", model: "gemini-3.8-flash-high" };
// Review and test cross-check the implementer with another provider when one is connected, else Opus (#856).
// The reviewer stays on Codex or Claude (team rules: Opus reviews code); the tester may also run on Gemini.
const CROSS = { cross: true, chain: [CODEX, OPUS] };
const CROSS_TEST = { cross: true, chain: [CODEX, GEMINI, OPUS] };

const BASE = { lead: [SONNET], impl: [OPUS], review: CROSS, test: CROSS_TEST, design: [SONNET], docs: [SONNET] };
const DEFAULT_GRID = {
  plan: { ...BASE, lead: [FABLE, OPUS], impl: [FABLE, OPUS], design: [FABLE, OPUS] },
  impl: BASE,
  review: BASE,
  docs: { ...BASE, impl: [SONNET] },
  // Quickfix (#768): one Opus 5.5 implementer, no reviewer; the lead may still pick Sonnet for a trivial change.
  quickfix: { ...BASE, impl: [OPUS], test: { cross: true, chain: [CODEX, GEMINI, SONNET] } },
  research: { ...BASE, lead: [CODEX, SONNET], impl: [CODEX, OPUS] },
};

const chainOf = (mode, role) => {
  const v = DEFAULT_GRID[mode]?.[role];
  if (!v) return { cross: false, chain: [] };
  return Array.isArray(v) ? { cross: false, chain: v } : v;
};

/** The built-in grid as plain cells (first choice of each chain), for the UI's "기본값" column and reset. */
export function defaultCells() {
  const out = {};
  for (const m of MODE_IDS) {
    out[m] = {};
    for (const r of ROLES) {
      const { chain, cross } = chainOf(m, r.id);
      out[m][r.id] = { ...cellOf(chain[0] ?? C(r.model), r), fallbacks: chain.slice(1).map(x => cellOf(x, r)), cross };
    }
  }
  return out;
}

const cellOf = (choice, role) => ({ provider: choice.provider, model: choice.model ?? null, effort: choice.effort ?? null, perm: choice.perm ?? role.perm ?? "auto" });

const bad = msg => Object.assign(new Error(msg), { status: 400 });

/** Strips a hint to one short line of plain text. */
const cleanHint = t => String(t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, HINT_MAX);

/**
 * The stored part of a raw drawing.json value, shape-checked only (models are checked against the live list
 * when they are used): cells with string fields, hints with short strings. Anything else is dropped.
 */
export function readStored(raw) {
  const out = { cells: {}, hints: {} };
  if (!isObj(raw)) return out;
  if (isObj(raw.cells)) {
    for (const [m, roles] of Object.entries(raw.cells)) {
      if (!MODE_IDS.includes(m) || !isObj(roles)) continue;
      for (const [r, c] of Object.entries(roles)) {
        if (!ROLES.some(x => x.id === r) || !isObj(c)) continue;
        const provider = PROVIDER_ALIASES[c.provider];
        if (!provider || typeof c.model !== "string" || !c.model) continue;
        (out.cells[m] ??= {})[r] = {
          provider, model: c.model,
          effort: typeof c.effort === "string" && c.effort ? c.effort : null,
          perm: PERMS.includes(c.perm) ? c.perm : "auto",
        };
      }
    }
  }
  if (isObj(raw.hints)) for (const [k, t] of Object.entries(raw.hints)) if (typeof t === "string" && k.length <= 80) out.hints[k] = cleanHint(t);
  return out;
}

/** Validates one cell against the models offered now (and the provider's permission rules). Throws status 400. */
export function checkCell(cell, models) {
  if (!isObj(cell)) throw bad("칸 값이 올바르지 않아요");
  const provider = PROVIDER_ALIASES[cell.provider];
  if (!provider) throw bad("제공사는 claude, codex, agy 중 하나예요");
  const model = models.find(m => m.id === cell.model);
  if (!model) throw bad(`지금 고를 수 없는 모델이에요: ${String(cell.model ?? "").slice(0, 60)}`);
  if (model.provider !== provider) throw bad(`${String(cell.model).slice(0, 60)} 모델은 ${PROVIDER_NAMES[provider]} 모델이 아니에요`);
  const perm = cell.perm == null || cell.perm === "" ? "auto" : String(cell.perm);
  checkPerm(provider, perm);
  const effort = checkEffort(model, cell.effort ?? null);
  return { provider, model: model.id, effort, perm };
}

/**
 * Applies a PUT body to the stored profiles and returns the next stored value (null = nothing left to store).
 * Body: { reset: true | <mode> } clears all or one mode (hints too on a full reset);
 *       { cells: { <mode>: { <role>: cell | null } } } sets or clears cells;
 *       { hints: { <model id or provider>: text | null } } sets or clears hints ("" clears too).
 */
export function patchProfiles(stored, body, models) {
  if (!isObj(body)) throw bad("본문이 올바르지 않아요");
  const next = { cells: structuredClone(stored.cells || {}), hints: { ...(stored.hints || {}) } };
  if (body.reset !== undefined) {
    if (body.reset === true) { next.cells = {}; next.hints = {}; }
    else if (MODE_IDS.includes(body.reset)) delete next.cells[body.reset];
    else throw bad("reset은 true나 모드 이름이에요");
  }
  if (body.cells !== undefined) {
    if (!isObj(body.cells)) throw bad("cells가 올바르지 않아요");
    for (const [m, roles] of Object.entries(body.cells)) {
      if (!MODE_IDS.includes(m)) throw bad(`알 수 없는 모드예요: ${String(m).slice(0, 30)}`);
      if (!isObj(roles)) throw bad("cells가 올바르지 않아요");
      for (const [r, c] of Object.entries(roles)) {
        if (!ROLES.some(x => x.id === r)) throw bad(`알 수 없는 역할이에요: ${String(r).slice(0, 30)}`);
        if (c === null) { delete next.cells[m]?.[r]; if (next.cells[m] && !Object.keys(next.cells[m]).length) delete next.cells[m]; continue; }
        (next.cells[m] ??= {})[r] = checkCell(c, models);
      }
    }
  }
  if (body.hints !== undefined) {
    if (!isObj(body.hints)) throw bad("hints가 올바르지 않아요");
    for (const [k, t] of Object.entries(body.hints)) {
      if (!(PROVIDERS.includes(k) || models.some(m => m.id === k))) throw bad(`알 수 없는 모델이에요: ${String(k).slice(0, 60)}`);
      if (t === null || (typeof t === "string" && !cleanHint(t))) { delete next.hints[k]; continue; }
      if (typeof t !== "string") throw bad("힌트는 글자로 넣어 주세요");
      next.hints[k] = cleanHint(t);
    }
  }
  return Object.keys(next.cells).length || Object.keys(next.hints).length ? next : null;
}

/** The hint for a model: the user's, else the built-in one, by model id then by provider. */
export function hintFor(model, hints = {}) {
  if (!model) return "";
  return hints[model.id] ?? DEFAULT_HINTS[model.id] ?? hints[model.provider] ?? DEFAULT_HINTS[model.provider] ?? "";
}

const why = (choice, isConnected, models) => {
  if (!isConnected(choice.provider)) return `${PROVIDER_NAMES[choice.provider]} 연결 안 됨`;
  if (choice.model && !models.some(m => m.id === choice.model && m.provider === choice.provider)) return `${String(choice.model).slice(0, 60)} 모델 없음`;
  if (!choice.model && !models.some(m => m.provider === choice.provider)) return `${PROVIDER_NAMES[choice.provider]} 모델 목록 없음`;
  return null;
};

/**
 * The profile a new session of `role` runs with in `mode`. Tries the user's cell, then the built-in chain,
 * then the role's preset model; the first choice whose provider is connected and whose model is listed wins.
 * `note` says in one line why an earlier choice was skipped (shown to the lead and in the UI), else null.
 *
 * @param {{ mode?: string, role: string, stored?: object, models: object[], isConnected: (provider: string) => boolean, roleModel?: string }} o
 *   roleModel: the role's model from 설정 (roleModels), used before the built-in preset as the last resort.
 *   perm: a permission mode the caller already chose (plan step or item); choices whose provider cannot run it are skipped.
 * @returns {{ mode, role, provider, model, effort, perm, source: "user"|"default"|"preset", note: string|null } | null}
 *   null when nothing usable is connected at all.
 */
export function resolveProfile({ mode, role, stored = {}, models, isConnected, roleModel, perm: askedPerm }) {
  const m = MODE_IDS.includes(mode) ? mode : DEFAULT_MODE;
  const preset = ROLES.find(r => r.id === role);
  if (!preset) return null;
  const { chain, cross } = chainOf(m, role);
  const user = stored.cells?.[m]?.[role];
  const candidates = [
    ...(user ? [{ ...user, source: "user" }] : []),
    ...chain.map(c => ({ ...cellOf(c, preset), source: "default" })),
    ...[roleModel, preset.model].filter(Boolean).map(id => ({ provider: models.find(x => x.id === id)?.provider ?? "claude", model: id, effort: null, perm: preset.perm ?? "auto", source: "preset" })),
  ];
  // Cross-check: review and test avoid the implementer's model of the same mode while another choice works.
  const avoid = cross && !user ? resolveProfile({ mode: m, role: "impl", stored, models, isConnected })?.model : null;
  const skipped = [];
  let crossSkipped = null;
  for (const c of candidates) {
    const reason = why(c, isConnected, models);
    if (reason) { skipped.push(reason); continue; }
    const model = c.model ?? models.find(x => x.provider === c.provider).id;
    // A perm the caller asked for (a plan step's or item's own) wins; a provider that cannot run it is skipped.
    const perm = askedPerm || c.perm;
    try { checkPerm(c.provider, perm); } catch { skipped.push(`${PROVIDER_NAMES[c.provider]}는 ${perm} 모드를 쓸 수 없음`); continue; }
    if (avoid && model === avoid) { crossSkipped ??= { ...c, model, perm }; continue; }
    let effort = c.effort ?? null;
    try { checkEffort(models.find(x => x.id === model), effort); } catch { effort = null; }
    return { mode: m, role, provider: c.provider, model, effort, perm, source: c.source, note: skipped.length ? `대신 ${model}: ${[...new Set(skipped)].join(", ")}` : null };
  }
  // Only the implementer's own model was usable: reviewing with it beats no reviewer.
  if (crossSkipped) return { mode: m, role, provider: crossSkipped.provider, model: crossSkipped.model, effort: crossSkipped.effort ?? null, perm: crossSkipped.perm, source: crossSkipped.source, note: ["구현자와 다른 모델이 없어 같은 모델을 써요", ...new Set(skipped)].join(", ") };
  return null;
}

/** The whole grid as the 설정 UI shows it: every mode × role resolved, plus hints and the built-in defaults. */
export function profileGrid({ stored = {}, models, isConnected, roleModels = {} }) {
  const grid = {};
  for (const m of MODE_IDS) {
    grid[m] = {};
    for (const r of ROLES) {
      const p = resolveProfile({ mode: m, role: r.id, stored, models, isConnected, roleModel: roleModels[r.id] });
      grid[m][r.id] = { cell: stored.cells?.[m]?.[r.id] ?? null, resolved: p, hint: p ? hintFor(models.find(x => x.id === p.model), stored.hints) : "" };
    }
  }
  return {
    modes: MODES,
    roles: ROLES.map(r => ({ id: r.id, name: r.name })),
    defaults: defaultCells(),
    hints: { ...DEFAULT_HINTS, ...(stored.hints || {}) },
    stored,
    grid,
  };
}
