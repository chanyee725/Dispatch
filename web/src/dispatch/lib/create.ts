// 새 세션 dialog logic (#587), ported from Dispatch's CreateSessionDialog: rows of role / model / effort / mode / count,
// the POST /api/sessions body, and the notices shown above the start button. Pure so tests run without a browser.
import { pct, until } from './format.ts';
import type { Limits, Model, ProviderStatus, Role } from '../../../../shared/dispatch/types.ts';

export interface Row { key: number; role: string; model: string; effort: string; perm: string; prompt: string; n: number; open: boolean }

/** Modes each provider can run without going looser than chosen (server/dispatch/hub.js checkPerm). Claude runs them all. */
export const MODES_OF: Record<string, readonly string[]> = { openai: ['plan', 'auto'], gemini: ['acceptEdits', 'auto', 'plan'] };
export const permsFor = (provider: string | undefined, perms: readonly string[]) => {
  const allowed = provider ? MODES_OF[provider] : undefined;
  return allowed ? perms.filter(p => allowed.includes(p)) : [...perms];
};
/** The row's mode if the model's provider can run it, else the provider's first (strictest listed) mode. */
export const fitPerm = (perm: string, provider: string | undefined, perms: readonly string[]) => {
  const ok = permsFor(provider, perms);
  return ok.includes(perm) ? perm : (ok[0] ?? perm);
};

let keySeq = 0;
/** A row with the role's own model, mode and prompt (the role default). */
export const rowFor = (r: Role, n = 1): Row => ({ key: ++keySeq, role: r.id, model: r.model, effort: 'default', perm: r.perm, prompt: r.prompt, n, open: false });

/** The first rows: 관리자, 구현자, 리뷰어 when the server has those roles. */
export const initialRows = (roles: Role[]) =>
  ['lead', 'impl', 'review'].map(id => roles.find(r => r.id === id)).filter((r): r is Role => !!r).map(r => rowFor(r));

/** Provider ids in picker order, only those with at least one model. */
export const providerGroups = (models: Model[]) => ['claude', 'openai', 'gemini', ...models.map(m => m.provider)]
  .filter((p, i, a) => a.indexOf(p) === i && models.some(m => m.provider === p));

export const total = (rows: Row[]) => rows.reduce((a, r) => a + r.n, 0);

const providerOf = (models: Model[], id: string) => models.find(m => m.id === id)?.provider ?? 'claude';
export const disconnected = (rows: Row[], models: Model[], providers: Record<string, ProviderStatus>) =>
  rows.some(r => !providers[providerOf(models, r.model)]?.connected);

/** Notices above the start button, most blocking first. */
export function notices(rows: Row[], o: { models: Model[]; providers: Record<string, ProviderStatus>; limits: Limits; worktree: boolean }): string[] {
  const out: string[] = [];
  if (disconnected(rows, o.models, o.providers)) out.push('연결되지 않은 서비스의 모델이 있어요. 왼쪽 아래 모델 연결에서 먼저 연결하세요.');
  const five = o.limits.five;
  if (five != null && five >= 0.85 && rows.some(r => providerOf(o.models, r.model) === 'claude'))
    out.push(`Claude 5시간 한도를 ${pct(five)} 썼어요. Claude 세션 여러 개를 동시에 돌리면 ${until(o.limits.fiveReset)} 안에 한도에 걸릴 수 있어요.`);
  if (!o.worktree && total(rows) > 1) out.push('worktree 없이 여러 세션이 같은 폴더를 고치면 서로 충돌해요.');
  return out;
}

/** "Claude Opus 5.5 2개, GPT-5 1개": count per model label. */
export function summary(rows: Row[], models: Model[]): string {
  const by = new Map<string, number>();
  for (const r of rows) {
    const l = models.find(m => m.id === r.model)?.label ?? r.model;
    by.set(l, (by.get(l) ?? 0) + r.n);
  }
  return [...by].map(([l, n]) => `${l} ${n}개`).join(', ');
}

/** POST /api/sessions body. `folder`: the board's project scope (a top-level folder path), if one is picked. */
export function createBody(rows: Row[], commonPrompt: string, worktree: boolean, folder?: string | null) {
  return {
    commonPrompt: commonPrompt.trim(),
    worktree,
    ...(typeof folder === 'string' && folder ? { folder } : {}),
    items: rows.map(r => ({ role: r.role, model: r.model, effort: r.effort === 'default' ? null : r.effort, perm: r.perm, prompt: r.prompt, n: r.n })),
  };
}
