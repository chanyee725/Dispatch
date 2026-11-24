// Live data for the project dashboard (#686): the project's sessions, their branches against develop, and the PRs
// of those branches. Everything is metadata the server already exposes (GET /api/state, /api/branches, /api/prs);
// nothing is stored. Sessions follow the `session` / `removed` events; branches and PRs poll while the page shows.
import { useEffect, useMemo, useState } from 'react';
import { events } from '../lib/events';
import { isOpen } from '../dispatch/lib/format.ts';
import { sessionsOf } from '../dispatch/lib/folder.ts';
import { api } from '../api';
import { pollWhileVisible } from './model';
import type { Session } from '../../../shared/dispatch/types.ts';
import type { IssuesAnswer } from './issueBoard.ts';
import type { BoardTask } from '../dispatch/types.ts';

export type Feed<T> = T | 'failed' | null;

const get = <T,>(url: string, signal: AbortSignal): Promise<T | null> => fetch(url, { signal })
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null); // an abort can land while the body is read, not only in fetch()

const SESSIONS_POLL_MS = 15_000;
const SESSION_EVENT_GAP_MS = 1_500;
const BRANCHES_POLL_MS = 30_000;
const PRS_POLL_MS = 60_000;
/** The server answers at most this many branches per /api/prs call (routes.js PR_BRANCHES). */
export const PR_BRANCHES = 12;

/**
 * The project's sessions (open first, newest first) and the task board (stage and ETA, metadata only) from the same
 * GET /api/state, reloaded on every session event (at most every 1.5s).
 */
export function useProjectState(folder: string): { sessions: Feed<Session[]>; tasks: readonly BoardTask[] } {
  const [state, setState] = useState<{ sessions: Feed<Session[]>; tasks: readonly BoardTask[] }>({ sessions: null, tasks: [] });
  useEffect(() => {
    const ctl = new AbortController();
    setState({ sessions: null, tasks: [] });
    const load = () =>
      void get<{ sessions?: Session[]; tasks?: BoardTask[] }>('/api/state', ctl.signal).then((d) => {
        if (ctl.signal.aborted) return;
        // A failed reload keeps the list already shown.
        setState((old) =>
          d
            ? { sessions: sessionsOf(d.sessions ?? [], folder), tasks: Array.isArray(d.tasks) ? d.tasks : [] }
            : { sessions: Array.isArray(old.sessions) ? old.sessions : 'failed', tasks: old.tasks },
        );
      });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        load();
      }, SESSION_EVENT_GAP_MS);
    };
    const stop = pollWhileVisible(load, SESSIONS_POLL_MS);
    const offs = ['session', 'removed', 'tasks'].map((t) => events.subscribeJson<unknown>(t, soon));
    return () => {
      ctl.abort();
      stop();
      offs.forEach((off) => off());
      if (timer) clearTimeout(timer);
    };
  }, [folder]);
  return state;
}

export type BranchTip = { branch: string; ahead: number; behind: number; lastAt: number | null; state: 'open' | 'merged' | 'empty' | null; base: boolean; active?: boolean };
export type Branches = { base: string; tips: ReadonlyMap<string, BranchTip> };

/** Ahead/behind of every live session branch against the integration branch; `key` reloads at once when it changes. */
export function useBranches(key: string): Feed<Branches> {
  const [data, setData] = useState<Feed<Branches>>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const load = () =>
      void get<{ base: string; tips?: BranchTip[] }>('/api/branches', ctl.signal).then((d) => {
        if (ctl.signal.aborted) return;
        setData((old) => (d ? { base: d.base, tips: new Map((d.tips ?? []).map((t) => [t.branch, t])) } : old && old !== 'failed' ? old : 'failed'));
      });
    const stop = pollWhileVisible(load, BRANCHES_POLL_MS);
    return () => {
      ctl.abort();
      stop();
    };
  }, [key]);
  return data;
}

export type Pr = { number: number; state: 'open' | 'closed' | 'merged'; ci: 'success' | 'failure' | 'pending' | 'none'; url?: string; review?: 'approved' | 'changes' | 'required'; conflict?: true };
export type PrAnswer = { ok: true; pr: Pr } | { ok: false; reason: string };

/** PR tracking switch (설정 › PR 추적); null while loading. A failed read counts as on (the server's default). */
export function usePrTracking(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api.prTracking().then((r) => live && setOn(r.on), () => live && setOn(true));
    return () => {
      live = false;
    };
  }, []);
  return on;
}

/** PR of each branch through the server's gh tracking (cached 30s there). Skipped while `on` is false. */
export function usePrs(branches: readonly string[], on: boolean | null): Feed<ReadonlyMap<string, PrAnswer>> {
  const key = branches.slice(0, PR_BRANCHES).join(',');
  const [data, setData] = useState<Feed<ReadonlyMap<string, PrAnswer>>>(null);
  useEffect(() => {
    if (!on || !key) {
      setData(new Map());
      return;
    }
    const ctl = new AbortController();
    const load = () =>
      void get<{ prs?: Record<string, PrAnswer> }>(`/api/prs?branches=${encodeURIComponent(key)}`, ctl.signal).then((d) => {
        if (ctl.signal.aborted) return;
        setData((old) => (d ? new Map(Object.entries(d.prs ?? {})) : old && old !== 'failed' ? old : 'failed'));
      });
    const stop = pollWhileVisible(load, PRS_POLL_MS);
    return () => {
      ctl.abort();
      stop();
    };
  }, [key, on]);
  return data;
}

/** Sessions with a branch: open ones (their work in progress) and the latest closed ones (merged recently). */
export function useSessionBranches(sessions: Feed<Session[]>) {
  return useMemo(() => {
    const list = Array.isArray(sessions) ? sessions.filter((s) => !!s.branch) : [];
    const open = list.filter(isOpen);
    const byRecent = [...list].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const prBranches = [...new Set(byRecent.map((s) => s.branch!))].slice(0, PR_BRANCHES);
    return { open, withBranch: byRecent, prBranches };
  }, [sessions]);
}

const ISSUES_POLL_MS = 60_000;

/** Open GitHub issues with their PRs (#776; the server caches 60s). Skipped while PR tracking is off. */
export function useIssues(on: boolean | null): Feed<IssuesAnswer> {
  const [data, setData] = useState<Feed<IssuesAnswer>>(null);
  useEffect(() => {
    if (on === false) {
      setData({ ok: false, reason: 'disabled' });
      return;
    }
    if (on === null) return;
    const ctl = new AbortController();
    const load = () =>
      void get<IssuesAnswer>('/api/issues', ctl.signal).then((d) => {
        if (ctl.signal.aborted) return;
        // A failed reload keeps the list already shown.
        setData((old) => (d ?? (old && old !== 'failed' ? old : 'failed')));
      });
    const stop = pollWhileVisible(load, ISSUES_POLL_MS);
    return () => {
      ctl.abort();
      stop();
    };
  }, [on]);
  return data;
}
