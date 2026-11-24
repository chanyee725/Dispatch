// Agent activity log (E537, issue #654): what agent sessions did in the workspace's documents, as short events
// ("Jude가 07 서버 데이터 저장 작성을 시작했어요"). Built by server/cursor/activity.js from the cursor module's
// attribution and the hub's session state. Metadata only (who, which file, which section, when, what kind): never a
// transcript or tool text. Kept in <workspace>/.drawing/activity.json (newest ACTIVITY_MAX).
//   GET  /api/activity              -> ActivityLog
//   SSE  `activity`                 -> ActivityEvent (one new event)

export type ActivityKind = 'start' | 'progress' | 'finish' | 'error';

export interface ActivityEvent {
  /** Unique, sortable: `<at>-<seq>`. */
  id: string;
  at: number;
  kind: ActivityKind;
  /** Hub session id. */
  sid: string;
  /** The session's own name ("Jude"). Never a real name or email. */
  name: string;
  /** Role id (`impl`, `lead`, ...). */
  role: string;
  /** Provider id (`claude`, `openai`, `gemini`) of the session, when known: the 알림함 shows its mark (#811). */
  provider?: string;
  /** Cursor colour `#rrggbb`, when the session has one. */
  color?: string;
  /** Workspace-relative path of the file. */
  file: string;
  /** The file's title when it was read, else absent (the client falls back to the file name). */
  title?: string;
  /** progress: the section it worked on (the heading text, clipped). */
  section?: string;
}

export interface ActivityLog {
  events: ActivityEvent[];
}

/** Events kept on disk and sent to the page. */
export const ACTIVITY_MAX = 200;

const hasBatchim = (word: string) => {
  const ch = [...word.trim()].pop() ?? '';
  const c = ch.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
  // Digits read in Korean: 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 end in a consonant.
  if (/[013678]/.test(ch)) return true;
  // Latin names: 가 (most read with a vowel ending). Close enough for agent names.
  return false;
};

/** The subject particle for `name`: 이 after a final consonant, else 가. */
export const subjectOf = (name: string) => `${name}${hasBatchim(name) ? '이' : '가'}`;
/** The object particle: 을 after a final consonant, else 를. */
export const objectOf = (word: string) => `${word}${hasBatchim(word) ? '을' : '를'}`;

/** The file's name without folders and `.dpx.json`. */
export const fileStemOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.dpx\.json$/, '');

/** "Jude가 07 서버 데이터 저장 작성을 시작했어요" and the like (해요체). */
export function activitySentence(e: Pick<ActivityEvent, 'kind' | 'name' | 'file' | 'title' | 'section'>): string {
  const who = subjectOf(e.name || '에이전트');
  const doc = e.title?.trim() || fileStemOf(e.file);
  switch (e.kind) {
    case 'start':
      return `${who} ${doc} 작성을 시작했어요`;
    case 'progress':
      return e.section ? `${who} ${doc}의 ${objectOf(`‘${e.section}’ 섹션`)} 진행했어요` : `${who} ${doc} 작성을 진행했어요`;
    case 'finish':
      return `${who} ${doc} 작업을 끝냈어요`;
    case 'error':
      return `${who} ${doc} 작업 중에 멈췄어요`;
  }
}

/** Parses a stored or sent log; anything malformed is dropped. */
export function parseActivityLog(x: unknown): ActivityLog {
  const o = (x ?? {}) as { events?: unknown };
  const events = Array.isArray(o.events) ? o.events.filter(isActivityEvent).slice(-ACTIVITY_MAX) : [];
  return { events };
}

const KINDS = new Set(['start', 'progress', 'finish', 'error']);
export function isActivityEvent(x: unknown): x is ActivityEvent {
  const e = x as ActivityEvent | null;
  return !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.at === 'number' && KINDS.has(e.kind) && typeof e.sid === 'string' && typeof e.name === 'string' && typeof e.file === 'string';
}
