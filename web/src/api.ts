// Client for the server's API: project info, provider connections, limits, settings and user defaults.
import type { UsageDay } from '../../shared/dispatch/types.ts';

/** Model connection summary for the sidebar (Dispatch routes; GET only, nothing here starts a CLI). */
export type DispatchStatus = { enabled: boolean; reason?: string; message?: string };
/** docs/design/model-connection-contract.md. installed null = not checked yet. Never carries an account name or token. */
export type ProviderState = {
  installed: boolean | null;
  connected: boolean;
  busy?: boolean;
  url?: string | null;
  error?: string | null;
  name?: string;
  /** `claude --version` first line. */
  cli?: string | null;
  /** The CLI itself is logged in on this machine (independent of the Atelier connection). */
  cliLoggedIn?: boolean;
  /** How the CLI is logged in, e.g. 구독 계정 (claude.ai). */
  method?: string | null;
  /** The CLI can log in with an API key (Codex). */
  keySupported?: boolean;
};
export type LimitWindow = { label: string; used: number | null; reset?: number | null };
export type ProviderLimits = {
  claude?: { windows: LimitWindow[] } | null;
  /** Fable's own weekly window; null until a Fable turn has reported it. */
  fable?: { windows: LimitWindow[] } | null;
  /** OpenAI Codex's own windows from its CLI's session log; null until Codex is connected and has run. */
  openai?: { windows: LimitWindow[]; plan?: string | null } | null;
  /** Gemini reports no windows, only that its quota was hit and when it clears. */
  gemini?: { reached: boolean; reset: number | null } | null;
};

export type ProviderInfo = { installed?: boolean | null; connected?: boolean; busy?: boolean; url?: string | null; error?: string | null };
export type DispatchSettings = { guard: { enabled: boolean; five: number; seven: number; fable?: number; /** Codex thresholds (#676). */ openai?: { five?: number; seven?: number } }; team: { ctxHandoff?: number; handoffMTokens?: number } & Record<string, unknown> };

/** GET /api/user-defaults (docs/design/user-defaults.md). Metadata only. */
export type UserDefaultsValues = {
  theme?: 'system' | 'light' | 'dark';
  workspace?: string;
  port?: number;
  prStatus?: boolean;
  workspaces?: { path: string; name: string }[];
  lastWorkspace?: string;
  /** User-set account label per provider id (#747), e.g. { claude: 'Max' }. A label only, never an email or account id. */
  accountLabels?: Record<string, string>;
};
export type UserDefaultsStatus = { file: string | null; values: UserDefaultsValues; error: string | null; problems: string[] };
export type UserDefaultsPatch = { theme?: 'system' | 'light' | 'dark' | null; workspace?: string | null; port?: number | null; prStatus?: boolean | null; accountLabels?: Record<string, string | null> };

export class ApiError extends Error {
  status: number;
  revision?: number;
  /** A stable reason the server gives for some errors (e.g. 'sessions_running'); branch on this, not the message. */
  code?: string;
  constructor(status: number, message: string, revision?: number, code?: string) {
    super(message);
    this.status = status;
    this.revision = revision;
    this.code = code;
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    // Every non-GET /api request needs x-drawing: 1 (server/app.js); a cross-site page can't send it.
    headers: {
      ...(method === 'GET' ? {} : { 'x-drawing': '1', 'x-drawing-client': 'app' }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data.revision, typeof data.code === 'string' ? data.code : undefined);
  return data as T;
}

export const api = {
  /** `project`: the git project's folder name when the server sends it (#773); else the workspace folder's name. */
  info: () => call<{ workspace: string; mode?: 'drawing' | 'project'; project?: string | null }>('GET', '/api/info'),
  dispatch: () => call<DispatchStatus>('GET', '/api/dispatch'),
  providers: () => call<{ providers: Record<string, ProviderState> }>('GET', '/api/state').then((r) => r.providers ?? {}),
  limits: () => call<ProviderLimits>('GET', '/api/limits'),
  /** Settings dialog (E57): full provider status, Dispatch settings, connect/disconnect. Login runs the user's own CLI. */
  dispatchState: () => call<{ providers?: Record<string, ProviderInfo>; settings?: DispatchSettings; models?: { id: string; label?: string; provider?: string }[] }>('GET', '/api/state'),
  /** Daily cost and tokens per model and role from the run records (14 days, numbers only; #819 사용량 tab). */
  usage: () => call<{ days: UsageDay[] }>('GET', '/api/usage').then((r) => (Array.isArray(r.days) ? r.days : [])),
  providerLogin: (id: string) => call<{ ok: boolean; connected: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/login`, {}),
  providerCancel: (id: string) => call<{ ok: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/cancel`, {}),
  /** Disconnects from Atelier only; the CLI's own login stays. */
  providerLogout: (id: string) => call<{ ok: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/logout`, {}),
  /** Disconnect and also log the CLI itself out on this machine (`cli: true`, as in Dispatch). */
  providerCliLogout: (id: string) => call<{ ok: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/logout`, { cli: true }),
  /** The CLI's own API-key login: the server hands the key to the CLI on stdin. The web keeps no copy (no storage, no logs). */
  providerKey: (id: string, key: string) => call<{ ok: boolean; connected: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/key`, { key }),
  providerRefresh: () => call<Record<string, ProviderInfo>>('POST', '/api/providers/refresh', {}),
  /** The email each provider's CLI is logged in with (#1023; Claude only, others null). Settings page only: not kept, not logged. */
  providerAccounts: () => call<{ accounts: Record<string, string | null> }>('GET', '/api/providers/accounts').then((r) => r.accounts ?? {}),
  saveDispatchSettings: (patch: { guard?: Partial<Omit<DispatchSettings["guard"], "fable" | "openai">> & { fable?: number | null; openai?: Record<string, number> }; team?: Partial<DispatchSettings['team']> }) =>
    call<DispatchSettings>('POST', '/api/settings', patch),
  /** The user's defaults in ~/.dispatch/drawing.json (E555): `error` is set when the file could not be read. */
  userDefaults: () => call<UserDefaultsStatus>('GET', '/api/user-defaults'),
  /** Saves some defaults; null clears one. 409 when the file is broken (it is never overwritten). */
  setUserDefaults: (patch: UserDefaultsPatch) => call<UserDefaultsStatus>('POST', '/api/user-defaults', patch),
  prTracking: () => call<{ on: boolean }>('GET', '/api/workspace/pr-tracking'),
  setPrTracking: (on: boolean) => call<{ on: boolean }>('POST', '/api/workspace/pr-tracking', { on }),
};

// Project folders: GET /api/workspace/projects, reduced to what the sidebar and the board's scope use.
type ProjectDto = { path: string; name: string };
export type ProjectInfo = {
  /** The project folder's path (its unique id). */
  id: string;
  path: string;
  name: string;
};
export const projectsApi = {
  projects: () =>
    call<{ projects: ProjectDto[] }>('GET', '/api/workspace/projects').then((r) => ({
      projects: (Array.isArray(r.projects) ? r.projects : []).map((p): ProjectInfo => ({ id: p.path, path: p.path, name: p.name })),
    })),
};
