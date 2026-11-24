// Compact "who and what now" block of the agent live view (E559, #728): name (a name tag in hover cards), role, model, status with time in
// state, and the running tool with its target and own clock. The panel header uses LiveSummaryView with data it
// already holds; #736's diagram hover card uses AgentLiveSummary, which loads its own. Never shows the session's
// folder (cwd), prompt or any transcript text.
import { useEffect, useState } from 'react';
import type { LiveAction } from '../../../shared/dispatch/live.ts';
import type { SessionState } from '../../../shared/dispatch/types.ts';
import { ModelTag } from '../dispatch/parts';
import { stateOf } from '../dispatch/lib/format.ts';
import { AgentTag } from '../home/AgentPanel';
import { useAgents } from '../home/useAgents';
import { cn } from '../lib/utils';
import { clock, liveStateLabel, liveStateTone, middle, span, ticking } from './format';
import { useAgentLive } from './useAgentLive';

export interface SummaryData {
  sid: string;
  name: string;
  color?: string;
  role?: string;
  provider?: string;
  modelLabel?: string;
  state: SessionState | null;
  stateSince?: number | null;
  current: LiveAction | null;
  /** Presence step (the plan step it works on). */
  step?: string;
}

const DOT: Record<string, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-destructive', idle: 'bg-idle' };

/** `plain`: the name as plain text instead of the cursor-shaped name tag (the panel header, #905). */
export function LiveSummaryView({ d, now, compact, titleId, plain }: { d: SummaryData; now: number; compact?: boolean; titleId?: string; plain?: boolean }) {
  const state = d.state ?? 'resting';
  const tone = liveStateTone(state);
  const label = liveStateLabel(state, !!d.current);
  return (
    <div className={cn('grid min-w-0 gap-1', compact && 'text-2xs')} data-live-summary={d.sid}>
      <div className="flex min-w-0 items-start gap-2">
        {plain ? (
          <h2 id={titleId} className="m-0 flex min-w-0 items-baseline gap-2 text-xs font-normal">
            <span className="truncate text-sm font-semibold text-foreground" data-live-name>{d.name}</span>
            {d.role && <span className="truncate text-xs text-muted-foreground">{d.role}</span>}
          </h2>
        ) : (
          <h2 id={titleId} className="m-0 flex min-w-0 items-start gap-2 text-xs font-normal">
            <AgentTag agent={{ sid: d.sid, name: d.name, color: d.color }} size={compact ? 'sm' : 'md'} />
            {d.role && <span className="mt-[7px] truncate text-xs leading-5 text-muted-foreground">{d.role}</span>}
          </h2>
        )}
        {d.provider && d.modelLabel && <ModelTag provider={d.provider} label={d.modelLabel} className={plain ? 'ml-auto shrink-0' : 'mt-[6px]'} />}
      </div>
      {/* Only the state label is a live region, so a state change is announced; the clock beside it ticks every
          second and stays outside it (aria-live off) so screen readers do not read it each second. */}
      <p className="m-0 flex items-center gap-1.5 text-xs" data-live-state={state}>
        <span aria-hidden className={cn('size-2 rounded-full', DOT[tone])} />
        <span aria-live="polite">{label}</span>
        {d.stateSince ? <span className="text-muted-foreground tabular-nums" data-live-clock>· {span(now - d.stateSince)}째</span> : null}
      </p>
      {compact && (
        <p className="m-0 flex min-w-0 gap-1.5 text-xs text-muted-foreground">
          {d.current ? (
            <>
              <span className="shrink-0 text-foreground">{d.current.label}</span>
              <span className="truncate" title={d.current.target}>{middle(d.current.target, 36)}</span>
              <span className="ml-auto shrink-0 tabular-nums">{clock(now - d.current.at)}</span>
            </>
          ) : (
            <span>도구 실행 없음</span>
          )}
        </p>
      )}
    </div>
  );
}

/** One clock per mounted view, 1s, paused while the tab is hidden or the state is frozen. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer || document.hidden) return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), 1000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [active]);
  return now;
}

/** Self-loading compact summary (for hover cards, #736). */
/** `name`: shown until the hub answers (or when it no longer knows the session). */
export function AgentLiveSummary({ sid, name, compact = true }: { sid: string; name?: string; compact?: boolean }) {
  const { live, session } = useAgentLive(sid);
  const { agents } = useAgents();
  const p = Array.isArray(agents) ? agents.find((a) => a.sid === sid) : undefined;
  const state = session ? stateOf(session) : ((p?.state as SessionState | null) ?? null);
  const now = useNow(!!state && ticking(state));
  const d: SummaryData = {
    sid,
    name: session?.name ?? p?.name ?? name ?? '',
    color: session?.color ?? p?.color,
    role: session?.roleName ?? p?.roleName,
    provider: session?.provider ?? p?.provider,
    modelLabel: session?.modelLabel ?? p?.modelLabel,
    state,
    stateSince: session?.stateSince ?? null,
    current: live?.current ?? null,
    step: p?.step,
  };
  return <LiveSummaryView d={d} now={now} compact={compact} />;
}
