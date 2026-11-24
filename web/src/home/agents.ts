// Agent sessions working in a project right now, for the project home's 지금 작업 중 panel (#592).
// Data: GET /api/workspace/agents (first answer) and the SSE event `agents` (a full snapshot of the whole workspace,
// sent on connect and on every change). Memory-only on the server; nothing here is stored either.
import { STATE } from '../dispatch/lib/format.ts';
import { AGENT_STATUS } from '../../../shared/dispatch/agent-status.ts';
import type { AgentPresence } from '../../../shared/dispatch/agent-presence.ts';
import type { SessionState } from '../../../shared/dispatch/types.ts';

export type { AgentPresence };

const STATUS_LABEL: Record<string, string> = { starting: '시작 중', running: '작업 중', waiting: '기다리는 중', idle: '쉼' };
/** The monitoring state when known (작업 중, 사람 기다림, 멈춤, …), else the hub status. */
export const agentStateLabel = (a: Pick<AgentPresence, 'status' | 'state'>) =>
  (a.state && STATE[a.state as SessionState]?.label) || STATUS_LABEL[a.status] || a.status;
/**
 * Doing something now (the spinner, #785): running or starting by the hub, and working by the monitor when it has a
 * word. An idle or waiting session is live but never busy.
 */
export const isBusy = (a: Pick<AgentPresence, 'status' | 'state'>) => (a.status === 'running' || a.status === 'starting') && (!a.state || a.state === 'working');
/** Needs a person or is stuck (amber dot). */
export const needsLook = (a: Pick<AgentPresence, 'status' | 'state'>) => (a.state ? a.state === 'waiting' || a.state === 'stuck' || a.state === 'failed' : a.status === 'waiting');

/**
 * The project's agents in a fixed team order (#785): each lead, then the teammates it created, teams and teammates in
 * creation order; outside writers last by name. Activity never moves a row (busy shows as a spinner only), so the list
 * does not reshuffle every second.
 */
export function agentsIn(all: readonly AgentPresence[], project: string): AgentPresence[] {
  // '' = the whole project this server belongs to (#778): every agent counts.
  const mine = all.filter((a) => project === '' || a.project === project || (!!a.file && a.file.startsWith(`${project}/`)));
  const nOf = new Map(all.map((a) => [a.sid, a.n ?? Infinity]));
  const team = (a: AgentPresence) => (a.parent && nOf.has(a.parent) ? nOf.get(a.parent)! : (a.n ?? Infinity));
  const order = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1);
  return [...mine].sort(
    (a, b) =>
      Number(!!a.outside) - Number(!!b.outside) ||
      order(team(a), team(b)) ||
      Number(team(a) !== (a.n ?? Infinity)) - Number(team(b) !== (b.n ?? Infinity)) ||
      order(a.n ?? Infinity, b.n ?? Infinity) ||
      a.name.localeCompare(b.name) ||
      a.sid.localeCompare(b.sid),
  );
}

/**
 * Editing a diagram right now: the cursor module's status (server/cursor, shared/dispatch/agent-status.ts) says it is
 * writing or planning a diagram, and it holds a file. That is exactly when its live cursor sits on a canvas, so the
 * dashboard shows the pointer tag only then.
 */
export const isEditingDiagram = (a: Pick<AgentPresence, 'statusLabel' | 'file' | 'outside'>) =>
  !a.outside && !!a.file && (a.statusLabel === AGENT_STATUS.writeDiagram || a.statusLabel === AGENT_STATUS.thinkDiagram);

/** Role tones (the `--role-*` tokens in web/src/index.css). */
export type RoleTone = 'lead' | 'merge' | 'impl' | 'review' | 'test' | 'design' | 'docs' | 'other';
const ROLE_NAME: Record<Exclude<RoleTone, 'other'>, string> = { lead: '관리자', merge: '머지 담당', impl: '구현자', review: '리뷰어', test: '테스터', design: '디자이너', docs: '문서화' };

/**
 * The role badge of a session: its tone and the label shown next to the colour (never colour alone). The server's
 * role ids (server/dispatch/roles.js) map directly; a role named for merging (병합, 머지) gets the merge tone; an
 * outside writer reads 외부 API.
 */
export function roleBadge(a: Pick<AgentPresence, 'role' | 'roleName' | 'outside'>): { tone: RoleTone; label: string } {
  if (a.outside) return { tone: 'other', label: '외부 API' };
  const name = a.roleName?.trim() ?? '';
  const id = a.role in ROLE_NAME ? (a.role as Exclude<RoleTone, 'other'>) : null;
  if (a.role === 'merge' || /병합|머지/.test(name)) return { tone: 'merge', label: name || ROLE_NAME.merge };
  if (id) return { tone: id, label: name || ROLE_NAME[id] };
  return { tone: 'other', label: name || a.role || '세션' };
}

/** "구현자 · Opus 5.5"; an outside writer says so instead. */
export function agentMeta(a: AgentPresence): string {
  if (a.outside) return '외부 API';
  return [a.roleName || a.role, a.modelLabel || a.model].filter(Boolean).join(' · ');
}

/** A safe `#rrggbb` colour or null (the server sends one; anything else is ignored). */
export const safeColor = (c: string | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : null);

/** Fallback title of a file path: its last part without .dpx.json. */
export const fileStem = (path: string) => (path.split('/').pop() ?? path).replace(/\.dpx\.json$/, '');

/** Parses an `agents` event or GET answer; anything malformed counts as no agents. */
export function parseAgents(x: unknown): AgentPresence[] {
  const list = (x as { agents?: unknown } | null)?.agents;
  if (!Array.isArray(list)) return [];
  return list.filter((a): a is AgentPresence => !!a && typeof a === 'object' && typeof (a as AgentPresence).sid === 'string' && typeof (a as AgentPresence).name === 'string');
}
