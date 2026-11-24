// Saved chat history in the sidebar (#968): the list from GET /api/chats (titles and times only; the server keeps
// them masked in .atelier/chat/), plus delete and clear-all. Memory only here: nothing is kept in storage.
import { useSyncExternalStore } from 'react';

export type ChatSummary = { id: string; title: string; createdAt: number; updatedAt: number; sessionId: string | null; count: number };

/** Fired after a conversation is saved (ChatDock save) to make the list reload; heard by the store below. */
export const HISTORY_CHANGED = 'atelier:chat-history-changed';
/** Asks the chat dock to resume a conversation: detail = { cliSessionId } (sent by openChatSession in web/src/chat/index.ts, heard by ChatDock). */
export const OPEN_CHAT_SESSION = 'atelier:open-chat-session';
/** Asks the chat dock to open on its current conversation (sent by openChat in web/src/chat/index.ts, for `#chat`). */
export const OPEN_CHAT = 'atelier:open-chat';

async function call<T>(method: string, url: string): Promise<T> {
  const res = await fetch(url, { method, headers: method === 'GET' ? {} : { 'x-drawing': '1', 'x-drawing-client': 'app' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`), { status: res.status });
  return data as T;
}

export const chatsApi = {
  list: () => call<{ chats: ChatSummary[] }>('GET', '/api/chats').then((r) => r.chats),
  remove: (id: string) => call<{ ok?: boolean }>('DELETE', `/api/chats/${encodeURIComponent(id)}`),
  clear: () => call<{ removed: number }>('DELETE', '/api/chats').then((r) => r.removed),
};

/** The row's one-line title: the saved title on one line, never empty. */
export const rowTitle = (c: Pick<ChatSummary, 'title'>) => c.title.replace(/\s+/g, ' ').trim() || '새 대화';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** "방금", "5분 전", "3시간 전", "어제", "4일 전", then the date. `now` is injectable for tests. */
export function ago(ms: number, now = Date.now()): string {
  const d = now - ms;
  if (!Number.isFinite(d) || d < MIN) return '방금';
  if (d < 60 * MIN) return `${Math.floor(d / MIN)}분 전`;
  if (d < DAY) return `${Math.floor(d / (60 * MIN))}시간 전`;
  const days = Math.floor(d / DAY);
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  const t = new Date(ms);
  return `${t.getMonth() + 1}월 ${t.getDate()}일`;
}

/** Newest first, as the server sends them; a defensive sort keeps a bad order from showing. */
export const sortChats = (list: ChatSummary[]) => [...list].sort((a, b) => b.updatedAt - a.updatedAt);

// --- tiny store: loaded once, reloaded on HISTORY_CHANGED and after our own deletes ---
export type HistoryState = { chats: ChatSummary[]; loaded: boolean; error: string | null };
let state: HistoryState = { chats: [], loaded: false, error: null };
const listeners = new Set<() => void>();
const set = (next: Partial<HistoryState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
let inflight: Promise<void> | null = null;

export function reloadHistory(): Promise<void> {
  inflight ??= chatsApi
    .list()
    .then((chats) => set({ chats: sortChats(chats), loaded: true, error: null }))
    .catch((e: Error) => set({ loaded: true, error: e.message }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function removeChat(id: string): Promise<void> {
  await chatsApi.remove(id);
  set({ chats: state.chats.filter((c) => c.id !== id) });
}

export async function clearChats(): Promise<number> {
  const n = await chatsApi.clear();
  set({ chats: [] });
  return n;
}

function subscribe(fn: () => void) {
  if (listeners.size === 0) window.addEventListener(HISTORY_CHANGED, onChanged);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) window.removeEventListener(HISTORY_CHANGED, onChanged);
  };
}
const onChanged = () => void reloadHistory();

export function useChatHistory(): HistoryState {
  const s = useSyncExternalStore(subscribe, () => state);
  return s;
}

