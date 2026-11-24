// The live-session card shared by the home 대시보드 and the 세션 보드 (#919), and the grid that lays them out.
import { type ReactNode } from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import { ProviderIcon } from '../ProviderIcon';
import { cn } from '../lib/utils';
import { AgentTag, RoleBadge } from './AgentPanel';
import { openAgentLive, useAgentLiveTarget } from '../live/store';
import { trackProps, trackTone } from './trackTone';
import { agentStateLabel, isBusy, isEditingDiagram, needsLook, type AgentPresence } from './agents';
import { relativeTime } from './model';
import type { TaskSummary } from './taskSummary';
import { TaskSummaryLine } from './TaskSummaryLine';

/**
 * Session cards in rows of 4 (#875): 4 a row when the card is wide enough (the home 대시보드 at 1660px), else 2,
 * else 1. CSS grid on the card's own width (a container query), so the columns follow the pane, not the window.
 * Breakpoints keep each card at about 180px or more: name and state text stay on one line (#819).
 */
export function SessionGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="@container/sessions">
      <ul aria-label={label} data-session-grid className="m-0 grid list-none grid-cols-1 content-start gap-2 p-2 @min-[24rem]/sessions:grid-cols-2 @min-[47.5rem]/sessions:grid-cols-4">
        {children}
      </ul>
    </div>
  );
}

/**
 * One live session per card (#785, #793, #889): name, role badge and run state (dot + word) on top; right under it what
 * the session works on (#912, when any source says); then a line with the plan step or what it does now (else a quiet idle/working note); a track that sweeps while it works; then model
 * left and time right. The pointer tag (the live cursor's look) shows only while the session edits a diagram
 * (isEditingDiagram); otherwise the name is plain. The card's body opens the session's live view; the file it holds
 * is its own link under the body (shown once, there).
 */
export function SessionCard({ agent: a, summary, title, onOpen, trail }: { agent: AgentPresence; summary: TaskSummary | null; title: string | null; onOpen: (p: string) => void; trail: readonly string[] }) {
  const busy = isBusy(a);
  // The card that opened the live view keeps a ring while it is open (#942, data-origin + aria-current).
  const selected = useAgentLiveTarget() === a.sid;
  const waiting = a.state ? a.state === 'waiting' : a.status === 'waiting';
  const track = trackProps(trackTone(a.statusLabel, busy ? 'working' : waiting ? 'waiting' : null));
  const look = !busy && needsLook(a);
  const editing = isEditingDiagram(a);
  const model = a.modelLabel || a.model;
  const state = agentStateLabel(a);
  // Second line (refresh mock, #889): the plan step, else what it does now, else the file it holds.
  const detail = a.step || a.statusLabel || null;
  // Working shows a loader icon; waiting gets the amber dot, idle a muted one (12px text-ok misses contrast on light).
  const tone = busy ? 'text-foreground' : look ? 'text-warn' : 'text-muted-foreground';
  const dotTone = look ? 'bg-warn' : 'bg-muted-foreground';
  return (
    <li
      data-agent={a.sid}
      data-busy={busy || undefined}
      data-look={look || undefined}
      data-editing={editing || undefined}
      data-origin
      aria-current={selected || undefined}
      className={cn('flex min-w-0 flex-col rounded-card bg-background text-xs transition-colors hover:bg-accent/60', look && 'session-look')}
    >
      {/* The same live view a 세션 보드 card opens (#728, #785). */}
      <button
        type="button"
        data-agent-live={a.sid}
        title={`${a.name} 진행상황 보기`}
        onClick={(e) => openAgentLive(a.sid, { trigger: e.currentTarget, from: 'board', trail })}
        className="press flex min-w-0 flex-col gap-2 rounded-card p-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            {editing ? (
              <AgentTag agent={a} size="sm" className="-mt-1 min-w-0" />
            ) : (
              <span data-agent-name className="min-w-0 truncate text-base leading-5 font-semibold tracking-[-0.01em] text-foreground">{a.name}</span>
            )}
            <RoleBadge agent={a} className="shrink-0" />
            <span data-agent-state className={cn('ml-auto inline-flex shrink-0 items-center gap-1.5 font-medium whitespace-nowrap', tone)} title={state}>
              {/* Waiting and idle keep a dot before the label; working shows a loader after it (2026-11-20). */}
              {!busy && <span aria-hidden className={cn('session-dot size-1.5 shrink-0 rounded-full', dotTone, !look && 'opacity-60')} />}
              {state}
              {busy && (
                // A square box that spins as a whole, so the ring turns on its own centre instead of wobbling.
                <span aria-hidden className="grid size-3.5 shrink-0 place-items-center motion-safe:animate-spin">
                  <LoaderCircle className="block size-3.5 text-muted-foreground" />
                </span>
              )}
            </span>
          </span>
          {summary ? <TaskSummaryLine summary={summary} /> : null}
        </span>
        <span className={cn('min-w-0 truncate', detail ? 'text-foreground/80' : 'text-muted-foreground')} title={detail ?? undefined}>
          {detail ?? (busy ? '작업 중이에요' : '다음 지시를 기다려요')}
        </span>
        {/* Working: a sliver sweeps the track in the tone of what it does now (trackTone); waiting: the track blinks;
            idle: a quiet line. */}
        <span aria-hidden {...track} />
        <span className="flex min-w-0 items-center justify-between gap-2 text-muted-foreground tabular-nums">
          {model ? (
            <span className="inline-flex min-w-0 items-center gap-1" title={model}>
              <ProviderIcon provider={a.provider} className="size-3 shrink-0" />
              <span className="truncate">{model}</span>
            </span>
          ) : <span />}
          {a.at ? <span className="shrink-0 whitespace-nowrap">{relativeTime(a.at)}</span> : null}
        </span>
      </button>
      {/* The file it holds, as its own link under the card body (#793). */}
      {a.file && title ? (
        <span className="flex min-w-0 items-center border-t px-3 py-1.5">
          <button type="button" onClick={() => onOpen(a.file!)} className="inline-flex min-w-0 items-center gap-1 rounded-sm text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            <FileText aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            <span className="sr-only">잡고 있는 파일 </span>
            <span className="truncate">{title}</span>
          </button>
        </span>
      ) : null}
    </li>
  );
}
