import { SUB_BUCKETS } from '../modelConnect.ts';

// Settings helpers: model connection polling for the sidebar rows (E57, E509), the usage-limit and session-length
// guards, the 설정 page's team fields and the per-provider usage view (#587). Kept free of React so node --test can
// check them. Status only: no account, email or token ever reaches here.
/** Polling stops after this long even if the server still says a login runs. */
export const LOGIN_POLL_LIMIT_MS = 10 * 60_000;
export const LOGIN_POLL_EVERY_MS = 2000;

type Clock = { now: () => number; setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (t: unknown) => void };
const realClock: Clock = { now: () => Date.now(), setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (t) => clearInterval(t as number) };

/**
 * Checks back every LOGIN_POLL_EVERY_MS while a CLI login runs and gives up after LOGIN_POLL_LIMIT_MS (calling
 * `onGiveUp` once). Returns a stop function. Each call starts a fresh window, so a new login restarts it.
 */
export function pollLogins(load: () => void, onGiveUp: () => void, clock: Clock = realClock): () => void {
  const started = clock.now();
  const t = clock.setInterval(() => {
    if (clock.now() - started > LOGIN_POLL_LIMIT_MS) {
      clock.clearInterval(t);
      onGiveUp();
      return;
    }
    load();
  }, LOGIN_POLL_EVERY_MS);
  return () => clock.clearInterval(t);
}

/**
 * Wraps an async action so a second call while the first runs is dropped (double clicks before the button
 * turns disabled). Returns false for a dropped call.
 */
export function oneAtATime<A extends unknown[]>(fn: (...a: A) => Promise<unknown>): (...a: A) => Promise<boolean> {
  let running = false;
  return async (...a: A) => {
    if (running) return false;
    running = true;
    try {
      await fn(...a);
    } finally {
      running = false;
    }
    return true;
  };
}

// Usage-limit and session-length guards (E509c), edited in the 설정 modal and page. Defaults mirror the server's
// (server/dispatch/settings.js GUARD_DEFAULTS). Each provider has its own usage guard (#676): Claude's 5시간·주간·Fable
// windows (stored as guard.five/seven/fable, as in standalone Dispatch), Codex's 5시간·주간 windows (guard.openai), and
// Gemini, which only says whether its quota was hit, so it has no value to set. A provider's guard holds new work of
// that provider only. The session-length guard covers every provider.
export type GuardField = { id: 'five' | 'seven' | 'fable' | 'codexFive' | 'codexSeven' | 'handoffMTokens' | 'ctxHandoff'; label: string; unit: string; min: number; max: number; def: number; hint: string };
export type GuardGroup = { title: string; hint: string; /** The provider whose windows the group guards; none = every provider. */ provider?: string; fields: GuardField[] };
export const GUARD_FIELDS: GuardGroup[] = [
  {
    title: 'Claude 사용량 한도',
    hint: 'Claude 사용량이 이만큼 차면 새 Claude 작업을 멈춰요.',
    provider: 'claude',
    fields: [
      { id: 'five', label: '5시간 한도', unit: '%', min: 1, max: 100, def: 90, hint: '' },
      { id: 'seven', label: '주간 한도', unit: '%', min: 1, max: 100, def: 85, hint: '' },
      { id: 'fable', label: 'Fable 주간 한도', unit: '%', min: 1, max: 100, def: 85, hint: '' },
    ],
  },
  {
    title: 'OpenAI Codex 사용량 한도',
    hint: 'Codex 사용량이 이만큼 차면 새 Codex 작업을 멈춰요.',
    provider: 'openai',
    fields: [
      { id: 'codexFive', label: 'Codex 5시간 한도', unit: '%', min: 1, max: 100, def: 90, hint: '' },
      { id: 'codexSeven', label: 'Codex 주간 한도', unit: '%', min: 1, max: 100, def: 85, hint: '' },
    ],
  },
  {
    title: 'Gemini 사용량 한도',
    hint: 'Gemini는 한도에 닿았는지만 알려 줘요. 닿으면 풀릴 때까지 새 Gemini 작업을 멈춰요.',
    provider: 'gemini',
    fields: [],
  },
  {
    title: '세션 길이',
    hint: '어느 모델이든 세션이 너무 길어지면 새 세션으로 넘겨요.',
    fields: [
      { id: 'handoffMTokens', label: '토큰 한도', unit: '백만', min: 2, max: 500, def: 15, hint: '' },
      { id: 'ctxHandoff', label: '컨텍스트 한도', unit: '%', min: 30, max: 95, def: 70, hint: '' },
    ],
  },
];

type GuardSettings = { five: number; seven: number; fable?: number | null; openai?: { five?: number; seven?: number } };
const CODEX_KEY = { codexFive: 'five', codexSeven: 'seven' } as const;

/** The value a field shows, from saved settings (guards are stored as 0..1 fractions; fable falls back to weekly). */
export function guardValue(id: GuardField['id'], s: { guard: GuardSettings; team: { ctxHandoff?: number; handoffMTokens?: number } }): number {
  const f = GUARD_FIELDS.flatMap((g) => g.fields).find((x) => x.id === id)!;
  if (id === 'five' || id === 'seven') return Math.round(s.guard[id] * 100);
  if (id === 'fable') return Math.round((s.guard.fable ?? s.guard.seven) * 100);
  if (id === 'codexFive' || id === 'codexSeven') {
    const v = s.guard.openai?.[CODEX_KEY[id]];
    return typeof v === 'number' ? Math.round(v * 100) : f.def;
  }
  return s.team[id] || f.def;
}

/** A settings patch for the given field values (percent fields become fractions; `fable: null` follows weekly again). */
export function guardPatch(values: Partial<Record<GuardField['id'], number | null>>) {
  const guard: Record<string, number | null | Record<string, number>> = {};
  const openai: Record<string, number> = {};
  const team: Record<string, number> = {};
  for (const [k, v] of Object.entries(values) as [GuardField['id'], number | null][]) {
    if (k === 'fable' && v === null) guard.fable = null;
    else if (v === null) continue;
    else if (k === 'five' || k === 'seven' || k === 'fable') guard[k] = v / 100;
    else if (k === 'codexFive' || k === 'codexSeven') openai[CODEX_KEY[k]] = v / 100;
    else team[k] = v;
  }
  if (Object.keys(openai).length) guard.openai = openai;
  return { ...(Object.keys(guard).length ? { guard } : {}), ...(Object.keys(team).length ? { team } : {}) };
}

/** A whole number in [min, max]; null otherwise. */
export function wholeIn(input: string, min: number, max: number): number | null {
  const n = Number(input.trim());
  if (!input.trim() || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export type GuardValues = Record<GuardField['id'], number>;
/** What the modal last loaded or saved: the shown values and whether Fable follows the weekly value (no own value). */
export type GuardSaved = { values: GuardValues; fableFollows: boolean };

/** True when settings have no own Fable value, so it follows the weekly one. */
export const fableFollows = (s: { guard: { fable?: number | null } }) => s.guard.fable == null;

/**
 * The values to send: only fields that differ from what was saved, so an untouched Fable value is never pinned (#552).
 * `follows` is whether Fable should follow the weekly value after this save: it is sent as `fable: null` when the
 * saved state had its own value, and left out otherwise. A Fable value the user typed while it followed is sent even
 * when it equals the value shown, since that pins it on purpose.
 */
export function changedValues(saved: GuardSaved, next: GuardValues, follows: boolean): Partial<Record<GuardField['id'], number | null>> {
  const out: Partial<Record<GuardField['id'], number | null>> = {};
  for (const id of Object.keys(next) as GuardField['id'][]) {
    if (id === 'fable') continue;
    if (next[id] !== saved.values[id]) out[id] = next[id];
  }
  if (follows) {
    if (!saved.fableFollows) out.fable = null;
  } else if (saved.fableFollows || next.fable !== saved.values.fable) out.fable = next.fable;
  return out;
}

/**
 * Reads the modal's field texts into values to save. An empty Fable field means "follow the weekly value" (#563):
 * it takes the weekly value and `follows` becomes true, instead of a range error. Any other bad field gives the
 * message to show.
 */
export function readGuardTexts(texts: Record<GuardField['id'], string>, follows: boolean): { values: GuardValues; follows: boolean } | { error: string } {
  const fields = GUARD_FIELDS.flatMap((g) => g.fields);
  const values = {} as GuardValues;
  const fableEmpty = !texts.fable.trim();
  for (const f of fields) {
    if (f.id === 'fable' && fableEmpty) continue;
    if (texts[f.id] === undefined) continue; // a caller that holds only some fields
    const v = wholeIn(texts[f.id], f.min, f.max);
    if (v === null) return { error: `${f.label}: ${f.min}~${f.max} 사이 숫자를 넣어 주세요` };
    values[f.id] = v;
  }
  if (fableEmpty) values.fable = values.seven;
  return { values, follows: follows || fableEmpty };
}

/**
 * Stops Esc at `target` (window, capture) while `isOpen()` is true, so a listener further down (the narrow sidebar
 * Sheet listens on document) does not also close (#552). Returns the cleanup that removes the listener (#563).
 */
export function stopEscWhileOpen(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, isOpen: () => boolean): () => void {
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape' && isOpen()) e.stopPropagation();
  };
  target.addEventListener('keydown', onKey, { capture: true });
  return () => target.removeEventListener('keydown', onKey, { capture: true });
}

// 설정 page (#587, ported from standalone Dispatch's SettingsPage): the team settings Atelier's server acts on.
// Values are saved through POST /api/settings `team`; the server checks every range again.
export type TeamNumberId = 'rotateLead' | 'rotateOthers' | 'maxChildren' | 'autoRemoveGraceSec' | 'stuckFails' | 'stuckSilentMinutes' | 'stuckMismatchMinutes' | 'stuckEtaRatio';
export type TeamToggleId = 'shareDeps' | 'dropWorktrees' | 'replyStyle' | 'autoRemoveDone' | 'autoRotateLong';
/** `decimal`: one decimal place, and 0 (off) or min..max (the server's ratio check). Ranges and defaults mirror server/dispatch/settings.js. */
export type TeamNumberField = { id: TeamNumberId; label: string; unit: string; min: number; max: number; def: number; hint: string; decimal?: boolean };
export const TEAM_NUMBERS: TeamNumberField[] = [
  { id: 'rotateLead', label: '관리자 대화 새로 시작', unit: '턴', min: 0, max: 100, def: 5, hint: '이 턴 수마다 대화를 요약해 새 세션으로 이어 가요. 0이면 이어 가지 않아요.' },
  { id: 'rotateOthers', label: '다른 역할 대화 새로 시작', unit: '턴', min: 0, max: 100, def: 10, hint: '구현자·리뷰어·테스터 등에 같은 규칙을 써요.' },
  { id: 'maxChildren', label: '관리자 한 명이 둘 수 있는 팀원', unit: '명', min: 1, max: 16, def: 8, hint: '동시에 열려 있는 팀원 수의 상한이에요.' },
  // Auto-remove of finished teammates (#632, #640).
  { id: 'autoRemoveGraceSec', label: '끝난 팀원 지우기 전 기다리는 시간', unit: '초', min: 3, max: 3600, def: 120, hint: '이 시간 안에 관리자가 다시 말을 걸면 지우지 않아요.' },
  // 멈춤 감지 (#624): the server's stuck checks (server/dispatch/state.js), 0 turns a check off.
  { id: 'stuckFails', label: '같은 검사가 연달아 실패', unit: '번', min: 0, max: 20, def: 3, hint: '같은 검사 명령이 이만큼 연달아 실패하면 멈춘 것으로 봐요. 0이면 끄기예요.' },
  { id: 'stuckSilentMinutes', label: '출력 없이 도는 시간', unit: '분', min: 0, max: 240, def: 10, hint: '돌고 있는 세션에 이만큼 출력이 없으면 멈춘 것으로 봐요. 0이면 끄기예요.' },
  { id: 'stuckMismatchMinutes', label: '단계와 다른 일을 하는 시간', unit: '분', min: 0, max: 240, def: 10, hint: '작업판은 계획·구현인데 이만큼 테스트만 돌리면 알려요. 0이면 끄기예요.' },
  { id: 'stuckEtaRatio', label: '예상 시간 초과 배수', unit: '배', min: 1, max: 10, def: 1.5, hint: '작업 단계가 예상 시간의 이 배수를 넘기면 알려요. 0이면 끄기예요.', decimal: true },
];
export const TEAM_TOGGLES: { id: TeamToggleId; label: string; def: boolean; hint: string }[] = [
  { id: 'shareDeps', label: '새 작업 폴더에 node_modules 넣기', def: true, hint: '프로젝트의 node_modules를 하드링크로 넣어요. 디스크를 더 쓰지 않아요.' },
  { id: 'dropWorktrees', label: '세션을 지우면 작업 폴더도 지우기', def: true, hint: '커밋 안 한 변경이 없을 때만 지워요. 브랜치는 남아요.' },
  { id: 'replyStyle', label: '답변 스타일 지침 넣기', def: true, hint: '모든 세션의 지시에 읽기 쉬운 답변 규칙을 붙여요.' },
  { id: 'autoRemoveDone', label: '일이 끝난 팀원 자동으로 지우기', def: true, hint: '보고가 관리자에게 가고 기다리는 질문이 없으면 지워요. 관리자는 지우지 않아요.' },
  // #969: past the token limit (사용 한도), the server swaps the session for a fresh one between turns.
  { id: 'autoRotateLong', label: '오래 쓴 세션 자동 교체', def: true, hint: '누적 토큰이 한도를 넘으면 턴이 끝난 뒤 같은 설정의 새 세션으로 바꿔요. 인계 내용과 팀원, 작업 보드도 옮겨요.' },
];

export type TeamValues = Record<TeamNumberId, number> & Record<TeamToggleId, boolean> & { roleModels: Record<string, string> };

/**
 * The form's values from saved team settings and the roles. A role's model is the saved override when there is one,
 * else the role's (preset) model: after a save the `settings` event can arrive before the `snapshot` with the new
 * roles, and reading the override first keeps the old model from showing for a moment (#616).
 */
export function teamValues(team: Record<string, unknown> | undefined, roles: readonly { id: string; model: string }[]): TeamValues {
  const t = team ?? {};
  const rm = t.roleModels && typeof t.roleModels === 'object' ? (t.roleModels as Record<string, unknown>) : {};
  const out = { roleModels: Object.fromEntries(roles.map((r) => [r.id, typeof rm[r.id] === 'string' && rm[r.id] ? (rm[r.id] as string) : r.model])) } as TeamValues;
  for (const f of TEAM_NUMBERS) out[f.id] = typeof t[f.id] === 'number' ? (t[f.id] as number) : f.def;
  for (const f of TEAM_TOGGLES) out[f.id] = typeof t[f.id] === 'boolean' ? (t[f.id] as boolean) : f.def;
  return out;
}

/** Only what changed, as a `team` patch; null when nothing did. Role models are sent per role. */
export function teamPatch(saved: TeamValues, next: TeamValues): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const f of TEAM_NUMBERS) if (next[f.id] !== saved[f.id]) out[f.id] = next[f.id];
  for (const f of TEAM_TOGGLES) if (next[f.id] !== saved[f.id]) out[f.id] = next[f.id];
  const rm: Record<string, string> = {};
  for (const [role, model] of Object.entries(next.roleModels)) if (model && model !== saved.roleModels[role]) rm[role] = model;
  if (Object.keys(rm).length) out.roleModels = rm;
  return Object.keys(out).length ? out : null;
}

/** A number field's value from its text, or null when it is out of range (whole numbers; `decimal`: 0 or min..max, one place). */
export function teamNumberIn(f: TeamNumberField, text: string): number | null {
  if (!f.decimal) return wholeIn(text, f.min, f.max);
  const n = Number(text.trim());
  if (!text.trim() || !Number.isFinite(n)) return null;
  const r = Math.round(n * 10) / 10;
  return r === 0 || (r >= f.min && r <= f.max) ? r : null;
}

/** The number fields among `texts` (a section's form holds only its own). */
const fieldsIn = (texts: Partial<Record<TeamNumberId, string>>) => TEAM_NUMBERS.filter((f) => typeof texts[f.id] === 'string');

/** Reads the given number fields' texts; the first bad one gives the message to show. */
export function readTeamNumbers(texts: Partial<Record<TeamNumberId, string>>): Partial<Record<TeamNumberId, number>> | { error: string } {
  const out: Partial<Record<TeamNumberId, number>> = {};
  for (const f of fieldsIn(texts)) {
    const v = teamNumberIn(f, texts[f.id]!);
    if (v === null) return { error: teamNumberError(f) };
    out[f.id] = v;
  }
  return out;
}

const teamNumberError = (f: TeamNumberField) => (f.decimal ? `${f.label}: 0 또는 ${f.min}~${f.max} 사이 숫자를 넣어 주세요` : `${f.label}: ${f.min}~${f.max} 사이 숫자를 넣어 주세요`);

/**
 * Each bad number field's message, keyed by field, in field order (the 설정 page shows these under the fields
 * instead of the browser's own bubble, #615). Empty when every field is fine.
 */
export function teamNumberErrors(texts: Partial<Record<TeamNumberId, string>>): Partial<Record<TeamNumberId, string>> {
  const out: Partial<Record<TeamNumberId, string>> = {};
  for (const f of fieldsIn(texts)) if (teamNumberIn(f, texts[f.id]!) === null) out[f.id] = teamNumberError(f);
  return out;
}

/** What the team form shows: number fields as typed text, the switches and each role's chosen model. */
export type TeamFormState = { texts: Record<TeamNumberId, string>; toggles: Record<TeamToggleId, boolean>; roleModels: Record<string, string> };

/** The form for saved values, nothing edited. */
export function teamForm(v: TeamValues): TeamFormState {
  return {
    texts: Object.fromEntries(TEAM_NUMBERS.map((f) => [f.id, String(v[f.id])])) as Record<TeamNumberId, string>,
    toggles: Object.fromEntries(TEAM_TOGGLES.map((f) => [f.id, v[f.id]])) as Record<TeamToggleId, boolean>,
    roleModels: { ...v.roleModels },
  };
}

/**
 * The form after the saved values change from `prev` to `next` (another tab, the sidebar 설정 modal, the server's
 * `settings` event or a save's answer, #615): a field still showing its `prev` value follows `next`; a field the user
 * edited keeps the edit. Roles that are new take their saved model.
 */
export function resyncTeamForm(prev: TeamValues, next: TeamValues, form: TeamFormState): TeamFormState {
  const texts = { ...form.texts };
  for (const f of TEAM_NUMBERS) if (texts[f.id] === String(prev[f.id])) texts[f.id] = String(next[f.id]);
  const toggles = { ...form.toggles };
  for (const f of TEAM_TOGGLES) if (toggles[f.id] === prev[f.id]) toggles[f.id] = next[f.id];
  const roleModels: Record<string, string> = {};
  for (const [role, model] of Object.entries(next.roleModels)) {
    const shown = form.roleModels[role];
    roleModels[role] = shown === undefined || shown === prev.roleModels[role] ? model : shown;
  }
  return { texts, toggles, roleModels };
}

/**
 * The saved values after a save: numbers and switches from the server's answer (its `team`), role models as sent
 * (the server keeps them in the snapshot's roles, which arrive separately). No answer: what was sent.
 */
export function savedAfterSave(answerTeam: Record<string, unknown> | undefined, sent: TeamValues): TeamValues {
  if (!answerTeam) return sent;
  const fromAnswer = teamValues(answerTeam, []);
  return { ...fromAnswer, roleModels: { ...sent.roleModels } };
}

// Per-provider usage (#587, ported from Dispatch's ProviderLimits): GET /api/limits answers one entry per provider
// id. Windows are read by that id, never assumed to be Claude's; a provider may add sub-buckets (Claude's Fable
// weekly window) that show in its own group.
export type UsageWindow = { label: string; used: number | null; reset?: number | null };
export type UsageEntry = { windows?: UsageWindow[]; plan?: string | null; reached?: boolean; reset?: number | null } | null | undefined;
export type UsageGroup = { id: string; name: string; windows: UsageWindow[]; plan: string | null; reached: boolean | null; reset: number | null };

/**
 * One group per connected provider, in the providers' order. `windows` empty means the CLI has not reported any
 * yet; `reached` is set for providers that only say whether a quota was hit (Gemini).
 */
export function usageGroups(limits: Record<string, UsageEntry>, providers: Record<string, { name?: string; connected?: boolean }>): UsageGroup[] {
  const out: UsageGroup[] = [];
  for (const [id, p] of Object.entries(providers)) {
    if (!p?.connected) continue;
    const own = limits[id];
    const windows = [own, ...(SUB_BUCKETS[id] ?? []).map((k) => limits[k])].flatMap((e) => (Array.isArray(e?.windows) ? e.windows : []));
    out.push({
      id,
      name: p.name || id,
      windows,
      plan: typeof own?.plan === 'string' ? own.plan : null,
      reached: typeof own?.reached === 'boolean' ? own.reached : null,
      reset: typeof own?.reset === 'number' ? own.reset : null,
    });
  }
  return out;
}

/**
 * Why session settings cannot change while Dispatch is off on this server, and what to do, in one line (#620).
 * `reason` is the server's code from GET /api/dispatch (server/dispatch/project.js OFF_MESSAGES). Messages that
 * already say what to do are used as they are; the server's message is the fallback for codes this list lacks.
 */
export function offReason(status: { reason?: string; message?: string } | null | undefined): string {
  const r = status?.reason;
  if (r === 'not-git') return '작업 공간이 git 저장소 밖이라 실행 기능이 꺼져 있어요. git 저장소 안의 폴더로 서버를 다시 열면 바꿀 수 있어요.';
  if (r === 'no-workspace') return '작업 공간이 없어서 실행 기능이 꺼져 있어요. 작업 공간 폴더를 정해 서버를 다시 열면 바꿀 수 있어요.';
  if (r === 'unsafe') return '프로젝트의 .dispatch 폴더가 심볼릭 링크라서 실행 기능이 꺼져 있어요. 링크를 지우고 서버를 다시 시작해 주세요.';
  const m = typeof status?.message === 'string' ? status.message.trim() : '';
  return m || '이 서버에선 실행 기능이 꺼져 있어요. 실행 기능이 켜진 서버에서 바꿀 수 있어요.';
}

// One 설정 modal with a left section list (#624). The chosen section is remembered in this browser (the id only).
export const SECTIONS = [
  { id: 'general', label: '일반' },
  { id: 'providers', label: '모델 연결' },
  { id: 'roles', label: '모드별 모델' },
  { id: 'team', label: '관리자와 팀' },
  { id: 'limits', label: '사용 한도' },
  { id: 'folders', label: '작업 폴더' },
  { id: 'stuck', label: '멈춤 감지' },
] as const;
export type SectionId = (typeof SECTIONS)[number]['id'];
export const SECTION_KEY = 'drawing:settings-section';
export const isSection = (v: unknown): v is SectionId => SECTIONS.some((s) => s.id === v);
/** The section to open: the one asked for, else the remembered one, else 일반. */
export const firstSection = (asked: unknown, remembered: unknown): SectionId => (isSection(asked) ? asked : isSection(remembered) ? remembered : 'general');
/** The team fields each team-backed section edits and saves (only these are validated and sent from that section). */
export const SECTION_FIELDS: Partial<Record<SectionId, { numbers: TeamNumberId[]; toggles: TeamToggleId[]; roleModels?: true }>> = {
  general: { numbers: [], toggles: ['replyStyle'] },
  roles: { numbers: [], toggles: [], roleModels: true },
  team: { numbers: ['rotateLead', 'rotateOthers', 'maxChildren', 'autoRemoveGraceSec'], toggles: ['autoRemoveDone', 'autoRotateLong'] },
  folders: { numbers: [], toggles: ['shareDeps', 'dropWorktrees'] },
  stuck: { numbers: ['stuckFails', 'stuckSilentMinutes', 'stuckMismatchMinutes', 'stuckEtaRatio'], toggles: [] },
};

/** `texts` reduced to the given fields, for a section's validation. */
export const pickTexts = (texts: Record<TeamNumberId, string>, ids: readonly TeamNumberId[]): Partial<Record<TeamNumberId, string>> => Object.fromEntries(ids.map((id) => [id, texts[id]]));

/**
 * Whether the guard form holds unsaved input (#638): a field that differs from the saved value as typed, or Fable
 * following the weekly value or not against what was saved. A following Fable mirrors 주간 한도, so it is not compared.
 */
export function guardDirty(saved: GuardSaved, texts: Record<GuardField['id'], string>, follows: boolean): boolean {
  if (follows !== saved.fableFollows) return true;
  return (Object.keys(saved.values) as GuardField['id'][]).some((id) => !(id === 'fable' && follows) && !sameNumber(texts[id] ?? '', saved.values[id]));
}

/** A typed number that reads as the saved one, whatever its spelling ('08', '1.50'); blank is never the same. */
export function sameNumber(text: string, saved: number): boolean {
  const t = text.trim();
  return t === String(saved) || (t !== '' && Number(t) === saved);
}

/**
 * The guard form's texts after the saved settings change from `prev` to `next` (another tab, the server's `settings`
 * event, #624): a field still showing its `prev` value follows `next`; an edited field keeps the edit. While Fable
 * follows the weekly value it mirrors the shown weekly text.
 */
export function resyncGuardTexts(prev: GuardSaved, next: GuardSaved, texts: Record<GuardField['id'], string>, follows: boolean): Record<GuardField['id'], string> {
  const out = { ...texts };
  for (const id of Object.keys(next.values) as GuardField['id'][]) if (out[id] === String(prev.values[id])) out[id] = String(next.values[id]);
  if (follows && out.fable.trim()) out.fable = out.seven;
  return out;
}

/**
 * What the session sections show (#624, #625). `status` is the shared GET /api/dispatch answer (null while loading);
 * `ready` and `unavailable` come from the session stream store. Dispatch off on the server reads as off with its
 * reason; the server on but the stream's state request failed reads as failed, with a retry, not as off.
 */
export type SettingsLoad = { kind: 'loading' } | { kind: 'off'; status: { enabled: boolean; reason?: string; message?: string } } | { kind: 'failed' } | { kind: 'ok' };
export function settingsLoad(status: { enabled: boolean; reason?: string; message?: string } | null, ready: boolean, unavailable: boolean): SettingsLoad {
  if (!status) return { kind: 'loading' };
  if (!status.enabled) return { kind: 'off', status };
  if (ready) return { kind: 'ok' };
  return unavailable ? { kind: 'failed' } : { kind: 'loading' };
}

/**
 * The values one section saves: the saved values with only that section's fields taken from the form, so another
 * section's unsaved edits are never sent with it (#624). Number texts must already be read (`nums`).
 */
export function sectionNext(saved: TeamValues, form: TeamFormState, nums: Partial<Record<TeamNumberId, number>>, fields: { numbers: readonly TeamNumberId[]; toggles: readonly TeamToggleId[]; roleModels?: true }): TeamValues {
  const next: TeamValues = { ...saved, roleModels: fields.roleModels ? { ...form.roleModels } : { ...saved.roleModels } };
  for (const id of fields.numbers) if (typeof nums[id] === 'number') next[id] = nums[id]!;
  for (const id of fields.toggles) next[id] = form.toggles[id];
  return next;
}
