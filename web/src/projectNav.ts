// App shell navigation: which 세션 보드 view is shown (from the address) and the one-letter shortcut.
// Pure, so it is tested without a browser.

/** The main panel: always the 세션 보드, on one of its tabs and scopes. */
export type Section = BoardSection;

/** 세션 보드 tabs (#731, docs/design/session-board-in-shell.md §1). */
export type BoardTab = 'sessions' | 'branches' | 'timeline' | 'usage';
/** The 세션 보드 in the shell. `folder`: undefined = 전체 프로젝트, null = 미분류, else a project folder path. */
export type BoardSection = { kind: 'board'; tab: BoardTab; folder?: string | null };
/** Something the board opens over itself once, from the address: the 상시 화면 or the 설정 dialog. */
export type BoardExtra = 'tv' | 'settings';
export type BoardRoute = BoardSection & { extra?: BoardExtra };

const BOARD_TABS: readonly string[] = ['sessions', 'branches', 'timeline', 'usage'];
const BOARD_EXTRAS: readonly string[] = ['tv', 'settings'];

/** Reads `#board`, `#board=usage`, `#board=timeline&folder=<path>` (`folder=` empty = 미분류); null for any other hash. */
export function parseBoardHash(hash: string): BoardRoute | null {
  const parts = hash.replace(/^#/, '').split('&');
  const m = /^board(?:=(.*))?$/.exec(parts[0] ?? '');
  if (!m) return null;
  const v = m[1] ?? '';
  const out: BoardRoute = { kind: 'board', tab: BOARD_TABS.includes(v) ? (v as BoardTab) : 'sessions' };
  if (BOARD_EXTRAS.includes(v)) out.extra = v as BoardExtra;
  const folder = folderPart(parts.slice(1));
  if (folder !== undefined) out.folder = folder;
  return out;
}

/** The `folder=` piece of a hash's parts: undefined when absent, null when empty (미분류). */
function folderPart(parts: readonly string[]): string | null | undefined {
  const p = parts.find((x) => x === 'folder' || x.startsWith('folder='));
  if (p === undefined) return undefined;
  let f = '';
  try {
    f = decodeURIComponent(p.slice('folder='.length));
  } catch {
    /* unreadable: 미분류 */
  }
  return f === '' ? null : f;
}

/** The address of a board route; parseBoardHash reads it back. */
export function boardHash(r: { tab: BoardTab; folder?: string | null; extra?: BoardExtra }): string {
  const view = r.extra ?? (r.tab === 'sessions' ? '' : r.tab);
  const folder = r.folder === undefined ? '' : `&folder=${encodeURIComponent(r.folder ?? '')}`;
  return `#board${view ? `=${view}` : ''}${folder}`;
}

/** True for the address that opens the chat dock (`#chat`). */
export const isChatHash = (hash: string) => /^#?chat$/.test(hash);

/** The board address for an old `/dispatch` hash (`#usage&folder=x`, `#folder=x`, `#tv`, `#settings`, `#timeline`). */
export function legacyBoardHash(hash: string): string {
  const own = parseBoardHash(hash);
  if (own) return boardHash(own);
  const parts = hash.replace(/^#/, '').split('&');
  const first = parts[0] ?? '';
  const view = first.includes('=') || first === 'folder' ? '' : first;
  const route: BoardRoute = { kind: 'board', tab: BOARD_TABS.includes(view) ? (view as BoardTab) : 'sessions' };
  if (BOARD_EXTRAS.includes(view)) route.extra = view as BoardExtra;
  const folder = folderPart(parts);
  if (folder !== undefined) route.folder = folder;
  return boardHash(route);
}

export type ShellKey = 'board';
const KEYS: Record<string, ShellKey> = { KeyS: 'board' };

// Where one-letter keys belong to something else: text fields, editors and dialogs.
const OWNED = 'input, textarea, select, .cm-editor, [contenteditable="true"], [contenteditable=""], dialog, [role="dialog"], [role="menu"], [role="listbox"]';

type KeyLike = { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; repeat: boolean; defaultPrevented: boolean; target: EventTarget | null };

/** The shell action for a key press (S), or null when the key is not one or belongs to something else. */
export function shellKey(e: KeyLike): ShellKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || e.repeat || e.defaultPrevented) return null;
  const k = KEYS[e.code];
  if (!k) return null;
  const t = e.target as { closest?: (s: string) => unknown } | null;
  if (t && typeof t.closest === 'function' && t.closest(OWNED)) return null;
  return k;
}

/** "42%" from a 0..1 fraction; null when unknown. */
export const percent = (used: number | null | undefined) => (used == null || !Number.isFinite(used) ? null : Math.max(0, Math.min(100, Math.round(used * 100))));
/** Sidebar usage colour steps (5-hour window, doc 6 §2.1): green under WARN_PERCENT, yellow from it, red from BAD_PERCENT. */
export const WARN_PERCENT = 60;
export const BAD_PERCENT = 85;

export type ModelLine = { id: string; name: string; installed: boolean | null; connected: boolean; pct: number | null; reached: boolean; busy?: boolean; /** The CLI's own https sign-in page while a login runs. */ url?: string | null; error?: string | null };
export type ModelTone = 'ok' | 'warn' | 'bad' | 'off';
/**
 * One sidebar model row: the short visible text next to the name (never colour alone, doc 6 §6) and the dot tone
 * (--ok, --warn, --muted-foreground). `enabled` false: agent sessions are off on this server, so every model reads 연결 안 됨 (text, not colour alone).
 */
export function modelStatus(m: ModelLine, enabled: boolean): { text: string; long: string; tone: ModelTone } {
  if (!enabled) return { text: '연결 안 됨', long: '연결 안 됨', tone: 'off' };
  if (m.busy && !m.connected) return { text: '연결 중', long: '연결하는 중', tone: 'off' };
  if (!m.connected) return { text: '연결 안 됨', long: '연결 안 됨', tone: 'off' };
  if (m.reached) return { text: '한도 도달', long: '사용 한도 도달', tone: 'bad' };
  if (m.pct == null) return { text: '연결됨', long: '연결됨', tone: 'ok' };
  return { text: `${m.pct}%`, long: `연결됨, 5시간 한도 ${m.pct}% 사용`, tone: m.pct >= BAD_PERCENT ? 'bad' : m.pct >= WARN_PERCENT ? 'warn' : 'ok' };
}

/** A plain left click (no modifier): links to the 세션 보드 open it in the shell; other clicks keep the browser's
 *  new tab / window behaviour through the link's real `/#board…` address. */
export function plainClick(e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}
