import { useSyncExternalStore } from "react";
import type { Entry, Limits, ProviderStatus, Provider, Session, Settings, Snapshot } from "./types";

export type ThemeChoice = "system" | "light" | "dark" | "monitor";

export type TaskStage = "plan" | "impl" | "review" | "test" | "merge" | "done" | "blocked";
export interface Ticket {
  id: string; lead: string | null; leadName: string | null; status: "open" | "resumed" | "closed" | "orphaned";
  reason: string; resetAt: number | null; createdAt: number; updatedAt: number;
  items: { title: string; stage: TaskStage; owner: string | null; note: string }[];
  leadLast: string; team: { name: string; status: string; branch: string | null; last: string }[];
}
export interface BoardTask {
  id: string; lead: string | null; title: string; stage: TaskStage; owner: string | null;
  createdAt: number; stageAt: number; updatedAt: number; etaAt: number | null; note: string;
  /** Stage entries, oldest first: stage and time only. Missing on tasks saved before v0.8. */
  stages?: { stage: TaskStage; at: number }[];
}

export interface BranchCommit { hash: string; short: string; parents: string[]; author: string; at: number; subject: string; merge: boolean; }
export interface BranchTip {
  branch: string; hash: string; short: string; ahead: number; base: boolean; active?: boolean;
  /** Commits on the base branch this one lacks. */
  behind?: number;
  /** Tip commit time (ms). */
  lastAt?: number | null;
  /** open: commits not on base yet · merged: its commits are on base · empty: nothing committed. */
  state?: "open" | "merged" | "empty" | null;
}
export interface BranchGraph { base: string; commits: BranchCommit[]; tips: BranchTip[]; }

export interface AppState extends Snapshot {
  /** UI preferences shared by every project's server (~/.dispatch/prefs.json). */
  prefs: { theme: ThemeChoice };
  /** Leads' task board (set_task). */
  tasks: BoardTask[];
  /** Work saved when the usage limit was reached; resumed after the reset. */
  tickets: Ticket[];
  ready: boolean;
  online: boolean;
  transcripts: Record<string, Entry[]>;
}

let state: AppState = {
  ready: false, online: false, transcripts: {}, prefs: { theme: readLocalTheme() }, tasks: [], tickets: [],
  project: { name: "", path: "", branch: null }, roles: [], perms: [], models: [],
  providers: {} as Record<Provider, ProviderStatus>,
  limits: { five: null, seven: null, fable: null, fiveReset: null, sevenReset: null, fableReset: null, updatedAt: null },
  settings: { guard: { enabled: true, five: 0.9, seven: 0.85 }, team: { rotateLead: 5, rotateOthers: 10, maxChildren: 8, replyStyle: true, shareDeps: true, dropWorktrees: true, roleModels: {} } },
  sessions: [],
};

function readLocalTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem("dispatch-theme");
    return v === "light" || v === "dark" || v === "monitor" ? v : "system";
  } catch {
    return "system";
  }
}

const listeners = new Set<() => void>();
function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
export const getState = () => state;

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-dispatch": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export async function loadTranscript(id: string) {
  const res = await api<{ messages: Entry[] }>("GET", `/api/sessions/${id}/messages`);
  set({ transcripts: { ...state.transcripts, [id]: res.messages } });
}

export function connect() {
  const es = new EventSource("/api/events");
  const on = <T,>(ev: string, fn: (d: T) => void) => es.addEventListener(ev, e => fn(JSON.parse((e as MessageEvent).data)));

  on<Snapshot>("snapshot", snap => set({ ...snap, ready: true, online: true }));
  on<Session>("session", s => {
    if (gone.has(s.id)) return;
    const i = state.sessions.findIndex(x => x.id === s.id);
    const sessions = i >= 0 ? state.sessions.map(x => (x.id === s.id ? s : x)) : [s, ...state.sessions];
    set({ sessions });
  });
  on<AppState["prefs"]>("prefs", prefs => set({ prefs }));
  on<BoardTask[]>("tasks", tasks => set({ tasks }));
  on<Ticket[]>("tickets", tickets => set({ tickets }));
  // Ids removed in this page's lifetime: a late update for one of them must not bring it back.
  const gone = new Set<string>();
  on<{ id: string }>("removed", ({ id }) => { gone.add(id); set({ sessions: state.sessions.filter(s => s.id !== id) }); });
  on<{ id: string; entry: Entry }>("message", ({ id, entry }) => {
    const cur = state.transcripts[id];
    if (cur) set({ transcripts: { ...state.transcripts, [id]: [...cur, entry] } });
  });
  on<Limits>("limits", limits => set({ limits }));
  on<Settings>("settings", settings => set({ settings }));
  on<Record<Provider, ProviderStatus>>("providers", providers => set({ providers }));
  es.onerror = () => set({ online: false });
  es.onopen = () => set({ online: true });
}

/** Saves the theme for every project (server file) and this browser (no-flash cache). */
export function setTheme(theme: ThemeChoice) {
  set({ prefs: { ...state.prefs, theme } });
  api("POST", "/api/prefs", { theme }).catch(() => {});
}
