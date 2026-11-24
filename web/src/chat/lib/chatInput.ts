// Pure parts of the chat composer (#968): image attachments, the "/" menu and the saved-conversation body.
// Images live in memory only (data URL base64 -> {mediaType, data}); nothing here touches storage.
import type { Entry } from '../../../../shared/dispatch/types.ts';

/** The server refuses more than this (server/dispatch/routes.js IMAGE_LIMITS); the box says so before sending. */
export const IMAGE_MAX = 4;
/** Raw bytes; base64 is 4/3 bigger and the server allows 5 MB of base64. */
export const IMAGE_MAX_BYTES = 3.5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export type Attachment = { id: string; mediaType: string; data: string; name: string };
/** The body part the server takes: [{ mediaType, data }]. */
export const imagesBody = (list: Attachment[]) => list.map(a => ({ mediaType: a.mediaType, data: a.data }));

/** Which of `files` can be attached next to `have` already attached; `error` is a sentence for the person. */
export function pickImages(files: { type: string; size: number }[], have: number): { ok: number[]; error: string | null } {
  const ok: number[] = [];
  let error: string | null = null;
  files.forEach((f, i) => {
    if (!IMAGE_TYPES.includes(f.type)) error = 'PNG, JPEG, GIF, WebP 이미지만 붙일 수 있어요.';
    else if (f.size > IMAGE_MAX_BYTES) error = '이미지는 3.5MB까지 붙일 수 있어요.';
    else if (have + ok.length >= IMAGE_MAX) error = `이미지는 한 번에 ${IMAGE_MAX}장까지 붙일 수 있어요.`;
    else ok.push(i);
  });
  return { ok, error };
}

/** "data:image/png;base64,AAA" -> { mediaType, data }; null for anything else. */
export function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  return m ? { mediaType: m[1]!, data: m[2]! } : null;
}

export type SlashItem = { name: string; description: string; kind: 'command' | 'skill' };
/** The one built-in: CLI's /clear. */
export const CLEAR_ITEM: SlashItem = { name: 'clear', description: '새 대화를 시작해요', kind: 'command' };

/** The text after "/" when the whole draft is one slash word (the menu is open), else null. */
export const slashQuery = (draft: string): string | null => {
  const m = /^\/([^\s/]*)$/.exec(draft);
  return m ? m[1]! : null;
};

/** Built-ins and skills whose name or description contains the query; names starting with it come first. */
export function slashItems(query: string, skills: { name: string; description?: string }[]): SlashItem[] {
  const q = query.toLowerCase();
  const all: SlashItem[] = [CLEAR_ITEM, ...skills.map(s => ({ name: s.name, description: s.description ?? '', kind: 'skill' as const }))];
  const hit = all.filter(i => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
  const rank = (i: SlashItem) => (i.name.toLowerCase().startsWith(q) ? 0 : 1);
  return hit.sort((a, b) => rank(a) - rank(b));
}

/** "/clear" typed in full (with or without trailing space) = new conversation. */
export const isClear = (draft: string) => /^\/clear\s*$/.test(draft.trim());

/** The text sent for a picked skill: Claude runs a skill from its slash name. */
export const skillText = (name: string, rest = '') => `/${name}${rest ? ` ${rest}` : ''}`;

/** POST /api/chats body from the transcript (#968 s1): text and tool names only; the server masks before disk. */
export function chatRecord(entries: Entry[], sessionId: string | null, id?: string) {
  const messages: { role: 'user' | 'assistant'; text: string; tools?: { name: string; summary: string }[] }[] = [];
  for (const e of entries) {
    if (e.kind === 'user' || e.kind === 'assistant') messages.push({ role: e.kind, text: e.text });
    else if (e.kind === 'tool') {
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') (last.tools ??= []).push({ name: e.tool ?? e.name ?? 'tool', summary: e.label ?? '' });
      else messages.push({ role: 'assistant', text: '', tools: [{ name: e.tool ?? e.name ?? 'tool', summary: e.label ?? '' }] });
    }
  }
  return { ...(id ? { id } : {}), sessionId, messages };
}

/** True when the saved conversation has something worth saving (a user message and an answer). */
export const worthSaving = (entries: Entry[] | undefined) => !!entries?.some(e => e.kind === 'user') && !!entries.some(e => e.kind === 'assistant');

export type SavedMessage = ReturnType<typeof chatRecord>['messages'][number];

/**
 * The save body for a resumed conversation: the messages saved before it was reopened, then this session's. The new
 * CLI session's transcript starts empty, so saving without the old part would cut the conversation short.
 */
export function withPrior(record: ReturnType<typeof chatRecord>, prior: SavedMessage[] | null | undefined) {
  return prior?.length ? { ...record, messages: [...prior, ...record.messages] } : record;
}

/** Header line for the session's spend: "12.3k 토큰 · $0.042"; empty before anything was used. */
export function usageText(usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | undefined, cost: number | null | undefined): string {
  if (!usage) return '';
  const n = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  if (!n && !cost) return '';
  const tok = n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
  return cost == null ? `${tok} 토큰` : `${tok} 토큰 · $${cost.toFixed(cost < 10 ? 3 : 2)}`;
}

/** A saved CLI session id (server/dispatch/chat-store.js SESSION_ID): what openChatSession accepts. */
export const isCliSessionId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v);
