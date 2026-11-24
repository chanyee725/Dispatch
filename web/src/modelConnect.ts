// Model connection state for the sidebar rows and the 모델 연결 dialog (E525, #570; all providers #587), ported from
// Dispatch's ConnectDialog/Sidebar/ProviderLimits. Everything is keyed by a provider id: PROVIDERS lists the rows the
// sidebar shows (Claude, OpenAI Codex, Gemini, as in Dispatch), and state, requests, copy and usage are looked up by
// that id. Pure, so node --test can check it.
// Server contract: docs/design/model-connection-contract.md. Status only: no account, email or token reaches here.
import type { DispatchStatus, LimitWindow, ProviderLimits, ProviderState } from './api';
import { modelStatus, percent, type ModelTone } from './projectNav.ts';

/** What the UI needs to know about one provider. `id` is the server's provider id (/api/providers/<id>/...). */
export type ProviderMeta = {
  id: string;
  /** Row and dialog title. */
  name: string;
  /** Short name in messages (Claude를 연결했어요). */
  short: string;
  /** The CLI it logs in through, e.g. Claude Code. */
  cliName: string;
  /** Usage from /api/limits, read under `limits[id]` (Claude also has Fable's own weekly window). */
  usage: boolean;
  /** May report no usage windows, only that its quota was hit (Gemini when agy /usage gives none); no block thresholds. */
  windowless?: boolean;
  /** The CLI can log in with an API key (POST /api/providers/<id>/key; Codex only, as in Dispatch). */
  keyLogin?: boolean;
  /** What the key field asks for, e.g. OpenAI API 키. */
  keyLabel?: string;
};

export const PROVIDERS: readonly ProviderMeta[] = [
  { id: 'claude', name: 'Claude', short: 'Claude', cliName: 'Claude Code', usage: true },
  { id: 'openai', name: 'OpenAI Codex', short: 'Codex', cliName: 'Codex CLI', usage: true, keyLogin: true, keyLabel: 'OpenAI API 키' },
  { id: 'gemini', name: 'Gemini', short: 'Gemini', cliName: 'Antigravity CLI (agy)', usage: true, windowless: true },
];
export const providerMeta = (id: string) => PROVIDERS.find((m) => m.id === id);
/** Korean object particle for a name (Claude를, ...): 을 after a final consonant in Hangul, else 를. */
export const objParticle = (name: string) => {
  const c = name.charCodeAt(name.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '을' : '를';
};

/** What the provider is doing, in the order Dispatch checks it. installed null = not checked yet (shows 연결). */
export type ConnectKey = 'off' | 'missing' | 'busy' | 'connected' | 'idle';

export function connectKey(p: ProviderState | undefined, enabled: boolean): ConnectKey {
  if (!enabled) return 'off';
  if (!p) return 'idle';
  if (p.installed === false) return 'missing';
  if (p.busy) return 'busy';
  if (p.connected) return 'connected';
  return 'idle';
}

export type RowTone = ModelTone;

/** The sidebar row: short text next to the name and the dot tone. Connected shows 5-hour usage like before. */
export function rowStatus(meta: ProviderMeta, p: ProviderState | undefined, enabled: boolean, limits: ProviderLimits): { key: ConnectKey; text: string; tone: RowTone } {
  const key = connectKey(p, enabled);
  if (key === 'missing') return { key, text: '설치 안 됨', tone: 'bad' };
  if (key === 'busy') return { key, text: '로그인 중', tone: 'warn' };
  if (key === 'connected') {
    const u = providerUsage(meta, limits);
    const five = u.windows.find((w) => w.label === '5시간') ?? null;
    const s = modelStatus({ id: meta.id, name: meta.name, installed: true, connected: true, pct: percent(five?.used), reached: u.reached }, true);
    return { key, text: s.text, tone: s.tone };
  }
  return { key, text: '연결 안 됨', tone: 'off' };
}

/** Dialog state label (Dispatch StateLabel). */
export const STATE_TEXT: Record<ConnectKey, string> = { off: '연결 안 됨', missing: '설치 안 됨', busy: '로그인 중', connected: '연결됨', idle: '연결 안 됨' };

/** The dialog's one action button for a state. null: nothing to press (agent sessions are off on this server). */
export type Action = 'connect' | 'cancel' | 'disconnect' | 'recheck';
export function actionFor(key: ConnectKey): Action | null {
  if (key === 'off') return null;
  if (key === 'missing') return 'recheck';
  if (key === 'busy') return 'cancel';
  if (key === 'connected') return 'disconnect';
  return 'connect';
}
export const ACTION_TEXT: Record<Action, string> = { connect: '연결', cancel: '취소', disconnect: '해제', recheck: '다시 확인' };

/** The API-key field shows only where Dispatch shows it: installed, not connected, no login running, CLI not logged in. */
export const keyLoginShown = (meta: ProviderMeta, p: ProviderState | undefined, enabled: boolean) =>
  !!meta.keyLogin && enabled && !!p && p.installed === true && !p.connected && !p.busy && !p.cliLoggedIn;
/** The CLI logout button: only while the CLI itself is logged in (it ends the CLI's login on this machine too). */
export const cliLogoutShown = (p: ProviderState | undefined, enabled: boolean) => enabled && !!p && p.installed === true && !p.busy && !!p.cliLoggedIn;

/** Second line under the name: CLI version and how it is logged in. Never an account name. */
export function metaLine(meta: ProviderMeta, p: ProviderState | undefined): string {
  if (!p || p.installed == null) return `${meta.cliName}로 로그인해요`;
  if (p.installed === false) return `${meta.cliName} 필요`;
  return [p.cli, p.cliLoggedIn ? p.method ?? '로그인됨' : 'CLI 로그인 안 됨'].filter(Boolean).join(' · ');
}

/** The CLI's sign-in page while a login runs; only https links are shown. */
export const loginUrl = (p: ProviderState | undefined) => (p?.busy && typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : null);

/** Message after a request finished (shown in the dialog's status line, where Dispatch shows a toast). */
export const connectedText = (meta: ProviderMeta) => `${meta.short}${objParticle(meta.short)} 연결했어요.`;
export function doneText(meta: ProviderMeta, action: Action, res: { connected?: boolean } | null): string | null {
  if (action === 'connect') return res?.connected ? connectedText(meta) : null;
  if (action === 'cancel') return '로그인을 취소했어요.';
  if (action === 'disconnect') return '연결을 해제했어요. CLI 로그인은 남아요.';
  return null;
}
export const keyDoneText = (meta: ProviderMeta, res: { connected?: boolean } | null) => (res?.connected ? connectedText(meta) : `${meta.short} 키를 넘겼지만 아직 연결되지 않았어요.`);
export const cliLogoutText = (meta: ProviderMeta) => `${meta.cliName}에서도 로그아웃했어요.`;

export type LimitRow = { label: string; pct: number | null; reset: number | null };
/** Usage entries a provider owns besides its own id (same map as settings/model.ts usageGroups): Claude's Fable weekly window. */
export const SUB_BUCKETS: Record<string, string[]> = { claude: ['fable'] };
type UsageEntry = { windows?: LimitWindow[]; reached?: boolean; reset?: number | null } | null | undefined;
const subWindows = (id: string, limits: ProviderLimits) =>
  (SUB_BUCKETS[id] ?? []).flatMap((k) => { const e = (limits as Record<string, UsageEntry>)[k]; return Array.isArray(e?.windows) ? e.windows : []; });

/**
 * This provider's usage from /api/limits, read under its own id (PR #598 review: never Claude's numbers on another row).
 * Claude: account windows, plus Fable's own weekly window once reported. Codex: its CLI's windows. Gemini: the windows
 * agy's /usage reports (#878), plus whether the quota was hit and when it clears.
 */
export function providerUsage(meta: ProviderMeta, limits: ProviderLimits): { windows: LimitWindow[]; extra: LimitWindow[]; reached: boolean; reset: number | null } {
  if (!meta.usage) return { windows: [], extra: [], reached: false, reset: null };
  const entry = (limits as Record<string, UsageEntry>)[meta.id];
  const windows = Array.isArray(entry?.windows) ? entry.windows : [];
  const extra = subWindows(meta.id, limits);
  const flagged = !!entry?.reached;
  // Gemini: only agy's quota error holds new work (hub providerHold), so a full bar alone is not 한도 도달 (#884).
  const reached = flagged || (meta.id !== 'gemini' && [...windows, ...extra].some((w) => (percent(w.used) ?? 0) >= 100));
  return { windows, extra, reached, reset: flagged ? (entry?.reset ?? null) : null };
}

/** Usage rows for the dialog (Dispatch ProviderLimits): this provider's windows, then Claude's Fable weekly window
 *  (`fable`, Claude only; null until reported). Null for a provider that reports no usage. */
export function limitRows(meta: ProviderMeta, limits: ProviderLimits): { main: LimitRow[]; fable: LimitRow[] | null; reached: boolean; reset: number | null } | null {
  if (!meta.usage) return null;
  const u = providerUsage(meta, limits);
  // The server already names the sub-bucket windows ('Fable 주간'): use its labels as they are.
  const row = (w: LimitWindow): LimitRow => ({ label: w.label, pct: percent(w.used), reset: w.reset ?? null });
  return {
    main: u.windows.map((w) => row(w)),
    fable: u.extra.length ? u.extra.map((w) => row(w)) : null,
    reached: u.reached,
    reset: u.reset,
  };
}

/** One provider's cell in the run view's 한도 column (#587): its usage rows, read by provider id like the dialog. */
export type LimitGroup = { id: string; name: string; rows: LimitRow[]; reached: boolean; reset: number | null; windowless: boolean };

/**
 * 한도 cells for the run view: one per connected provider, in PROVIDERS order. Rows are the provider's own windows
 * plus its SUB_BUCKETS ones (Claude's Fable weekly); never another provider's numbers.
 */
export function limitGroups(providers: Record<string, Pick<ProviderState, 'connected'> | undefined>, limits: ProviderLimits): LimitGroup[] {
  return PROVIDERS.filter((m) => m.usage && providers[m.id]?.connected).map((m) => {
    const r = limitRows(m, limits)!;
    return { id: m.id, name: m.short, rows: [...r.main, ...(r.fable ?? [])], reached: r.reached, reset: r.reset, windowless: !!m.windowless };
  });
}

/**
 * The run view's 한도 column (PR #617 review): read from the provider and usage state alone, so it shows for a finished
 * run too, not only while a run keeps the Dispatch store online. `loading` until /api/dispatch answered, `off` when the
 * server runs without Dispatch, else the cells.
 */
export function runLimits(status: DispatchStatus | null, providers: Record<string, Pick<ProviderState, 'connected'> | undefined>, limits: ProviderLimits): 'loading' | 'off' | LimitGroup[] {
  if (!status) return 'loading';
  if (!status.enabled) return 'off';
  return limitGroups(providers, limits);
}
