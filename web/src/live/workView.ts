// 작업 보기 in the agent live view (E673, #905): what the session is making right now. Pure helpers, so they can be
// tested without a browser. Memory only: nothing here is stored or logged.
import type { LiveAction, LiveFile } from '../../../shared/dispatch/live.ts';
import { parsePatch, type FileDiff } from '../dispatch/lib/patch.ts';

/** How often the code view asks for the diff again while it is on screen. */
export const WORK_POLL_MS = 4000;

const DOC_RE = /\.dpx(\.json)?$/i;
export const isDocPath = (p: string | null | undefined): p is string => !!p && DOC_RE.test(p);

/**
 * 'doc' while the document the session holds (`agent.file`) is its latest work; 'code' once it has edited a non-document
 * file after that, or when it holds no document at all.
 */
export function workMode(file: string | null | undefined, fileAt: number | null | undefined, files: readonly LiveFile[]): 'doc' | 'code' {
  if (!isDocPath(file)) return 'code';
  const since = fileAt ?? 0;
  return files.some((f) => f.edited && !f.doc && f.at > since) ? 'code' : 'doc';
}

/** The fields of GET /api/sessions/:id/diff this view reads. */
export interface DiffAnswer {
  patch: string;
  untracked: string[];
}

export interface ChangedFile {
  path: string;
  add: number;
  del: number;
  /** Not in git yet: no line counts, no patch. */
  untracked: boolean;
  /** Patch parts of this file (more than one when a merged branch changed it in several commits). */
  parts: FileDiff[];
  /** Last edit the live view saw (ms), when it saw one. */
  at: number | null;
}

/** `a/b.ts` from the diff and `b.ts` or `x/a/b.ts` from the live view are the same file when one path ends the other. */
export const samePath = (a: string, b: string) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

/**
 * The changed files, newest edit first (by the live view's own edit times), then the rest in patch order. Paths a
 * merged branch changed in several commits come out once with their counts summed.
 */
export function changedFiles(d: DiffAnswer, live: readonly LiveFile[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const f of parsePatch(d.patch ?? '')) {
    const cur = byPath.get(f.path);
    if (cur) {
      cur.add += f.add;
      cur.del += f.del;
      cur.parts.push(f);
    } else byPath.set(f.path, { path: f.path, add: f.add, del: f.del, untracked: false, parts: [f], at: null });
  }
  for (const p of d.untracked ?? []) if (!byPath.has(p)) byPath.set(p, { path: p, add: 0, del: 0, untracked: true, parts: [], at: null });
  const list = [...byPath.values()];
  for (const c of list) {
    const seen = live.filter((f) => f.edited && samePath(f.path, c.path));
    c.at = seen.length ? Math.max(...seen.map((f) => f.at)) : null;
  }
  // Stable sort: files the live view never saw keep patch order behind the ones it did.
  return list.map((c, i) => [c, i] as const).sort(([a, i], [b, j]) => (b.at ?? -1) - (a.at ?? -1) || i - j).map(([c]) => c);
}

/** Where a file link in the panel goes: a workspace document opens in the editor, a code file in 작업 보기. */
export interface FileLink {
  kind: 'doc' | 'code';
  path: string;
}

/**
 * A shown path the panel may link: relative, no `..`, no home (`~`), no drive letter or backslash, no control
 * characters. The server already keeps only workspace- or session-relative paths; this is the second fence.
 */
export function linkablePath(p: string | null | undefined): p is string {
  if (!p || p.length > 400 || /[\\\u0000-\u001f]/.test(p)) return false;
  if (p.startsWith('/') || p.startsWith('~') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** The link for one touched file, or null (outside the workspace and the session's folder, or an unsafe path). */
export function fileLink(f: LiveFile | null | undefined): FileLink | null {
  if (!f || f.outside || !linkablePath(f.path)) return null;
  if (f.doc) return isDocPath(f.path) ? { kind: 'doc', path: f.path } : null;
  return { kind: 'code', path: f.path };
}

/** Tool kinds whose target is a path (a shell command's target is its command line, never linked). */
const PATH_KINDS = new Set<LiveAction['kind']>(['read', 'edit', 'search']);

/** The file a tool call read or changed, when its target is one of the session's touched files; else null. */
export function actionFileLink(a: Pick<LiveAction, 'kind' | 'target'>, files: readonly LiveFile[]): FileLink | null {
  if (!PATH_KINDS.has(a.kind) || !a.target) return null;
  return fileLink(files.find((f) => f.path === a.target));
}
