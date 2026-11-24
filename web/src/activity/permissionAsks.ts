// Open permission prompts of sessions (#836), for 세션 요청 and the board. Pure (no React or DOM), so it runs under `node --test`.
// The tool input and description come already masked from the server (maskedPerm) and are only shown, never stored.
import type { Session } from '../../../shared/dispatch/types.ts';

export type PermissionAsk = {
  sessionId: string;
  session: string;
  requestId: string;
  tool: string;
  since: number | null;
  /** What runs once allowed: the command, the file, or the input as JSON; null when there is none. */
  detail: string | null;
  /** The CLI's own description of the request; null when empty. */
  description: string | null;
};

/** The part of a tool input a person checks before allowing it: a shell command or a file path, else the whole input. */
export function askDetail(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === 'string') return input.trim() || null;
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>;
    // A shell command is what matters (Bash also sends its own description); one lone field is shown bare.
    for (const k of ['command', 'cmd']) if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim();
    const keys = Object.keys(o).filter((k) => o[k] !== undefined);
    if (keys.length === 0) return null;
    if (keys.length === 1 && typeof o[keys[0]] === 'string') return (o[keys[0]] as string).trim() || null;
    return JSON.stringify(o, null, 2);
  }
  return String(input);
}

/** Up to `max` characters on one line, for the row; the full text opens below it. */
export const shortDetail = (text: string, max = 120) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** Open permission prompts, oldest first. */
export function permissionAsks(sessions: readonly Session[]): PermissionAsk[] {
  const out: PermissionAsk[] = [];
  for (const s of sessions) {
    for (const p of s.pending ?? []) {
      if (!p?.requestId) continue;
      out.push({
        sessionId: s.id,
        session: s.name,
        requestId: p.requestId,
        tool: p.tool || '도구',
        since: s.stateSince ?? s.updatedAt ?? null,
        detail: askDetail(p.input),
        description: typeof p.description === 'string' && p.description.trim() ? p.description.trim() : null,
      });
    }
  }
  return out.sort(oldestFirst);
}

const oldestFirst = (a: PermissionAsk, b: PermissionAsk) => (a.since ?? Infinity) - (b.since ?? Infinity);

/**
 * The list after one SSE `session` event (#836): that session's prompts replaced by the ones in its own `pending`,
 * or dropped when `gone` (a `removed` event). Same array back when nothing changed, so React does not re-render.
 */
export function withSession(asks: readonly PermissionAsk[], s: Pick<Session, 'id'> & Partial<Session>, gone = false): readonly PermissionAsk[] {
  const others = asks.filter((a) => a.sessionId !== s.id);
  const next = gone ? others : [...others, ...permissionAsks([s as Session])].sort(oldestFirst);
  const same = next.length === asks.length && next.every((a, i) => a.requestId === asks[i].requestId && a.detail === asks[i].detail && a.since === asks[i].since);
  return same ? asks : next;
}
