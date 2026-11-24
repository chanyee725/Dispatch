// "확인 필요" group at the top of 작업 보드 (#924; it was a strip above 세션): sessions waiting on a person, stuck or failed, late tasks, failed merge
// checks and usage limits from 75 %. Each row says why, for how long, and opens what to look at.
import { useEffect, useId, useMemo, useState } from 'react';
import { attentionTaskIds } from './lib/board.ts';
import { ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { attentionItems, elapsed, type AttentionItem, type AttentionKind } from '../../../shared/dispatch/attention.ts';
import { fmtK, fmtUsd, isOpen, stateOf, totalTok, until } from './lib/format.ts';
import { DotChip, StateChip } from './parts';
import { useDispatch } from './store';
import { useScoped } from './scope';
import type { Session } from './types';

/** Rows shown before "n건 더 보기". */
const SHOWN = 5;

export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// Non-session rows get their own label, so they also read without colour.
const KIND: Record<Exclude<AttentionKind, 'session'>, string> = { late: '지연', mismatch: '단계 불일치', merge: '병합 안 됨', limit: '한도' };

// Refresh chips (#897): neutral ground, the dot carries the level.
function Mark({ item }: { item: AttentionItem }) {
  if (item.kind === 'session') return <StateChip state={item.state ?? 'stuck'} />;
  return <DotChip tone={item.level} label={KIND[item.kind]} />;
}

/** "8분째", "14분 지연", "2시간 뒤 초기화". */
function howLong(item: AttentionItem, now: number) {
  if (item.kind === 'limit') return item.resetAt ? `${until(item.resetAt, now)} 뒤 초기화` : null;
  const e = elapsed(item.since, now);
  if (e == null) return null;
  if (item.kind === 'late') return e ? `${e} 지연` : '막 지연됐어요';
  return e ? `${e}째` : '방금';
}

const ACTION: Record<AttentionKind, string> = { session: '열기', late: '세션 열기', mismatch: '세션 열기', merge: '관리자 열기', limit: '사용량 보기' };

/** One row of the 확인 필요 group in 작업 보드 (#924): state mark, who, time; under it the short reason and the action. */
function Row({ item, now, onClick }: { item: AttentionItem; now: number; onClick?: () => void }) {
  const time = howLong(item, now);
  const Box = onClick ? 'button' : 'div';
  return (
    <li>
      <Box
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        className={cn(
          'group/row grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 px-4 py-2 text-left text-xs',
          onClick && 'cursor-pointer transition-colors hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
        )}
      >
        <span className="flex min-w-0"><Mark item={item} /></span>
        <span className="min-w-0 truncate font-medium" title={item.who}>{item.who}</span>
        <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">{time}</span>
        <span data-reason className="col-start-2 min-w-0 truncate text-xs text-muted-foreground" title={item.reason}>{item.reason}</span>
        <span data-go className={cn('col-start-3 inline-flex shrink-0 items-center justify-end gap-0.5 text-xs text-muted-foreground', onClick ? 'group-hover/row:text-foreground' : 'invisible')}>
          {ACTION[item.kind]}
          <ChevronRight aria-hidden className="size-3.5" />
        </span>
      </Box>
    </li>
  );
}

/** What needs a person, for the top group of 작업 보드 (#924). Tasks with a row here are left out of the board's own
 *  list (`taskIds`), so nothing shows twice. */
export function useAttention() {
  const { sessions, tasks } = useScoped();
  const limits = useDispatch(s => s.limits);
  const guard = useDispatch(s => s.settings.guard);
  const now = useNow();
  const items = useMemo(() => attentionItems({ sessions, tasks, limits, guard, now, stateOf }), [sessions, tasks, limits, guard, now]);
  return { items, now, taskIds: useMemo(() => attentionTaskIds(items), [items]) };
}

/** `onUsage` opens the limits screen; without it limit rows are not clickable. */
export function AttentionGroup({ items, now, onOpen, onUsage }: { items: AttentionItem[]; now: number; onOpen: (id: string) => void; onUsage?: () => void }) {
  const { sessions } = useScoped();
  const [all, setAll] = useState(false);
  const listId = useId();
  const go = (i: AttentionItem) =>
    i.kind === 'limit' ? onUsage : i.sessionId && sessions.some(s => s.id === i.sessionId) ? () => onOpen(i.sessionId!) : undefined;
  if (items.length === 0) return null;
  const urgent = items.filter(i => i.level === 'bad').length;
  return (
    <section aria-label="확인 필요" data-attention className="border-b">
      <header className="flex h-8 items-center gap-2 px-4 text-xs font-medium text-muted-foreground">
        <h3 className="m-0 min-w-0 flex-1 truncate text-xs font-medium">확인 필요</h3>
        <span className="shrink-0 tabular-nums">
          {urgent > 0 && <span className="text-destructive">급함 {urgent} · </span>}
          <span className="text-foreground">{items.length}건</span>
        </span>
      </header>
      <ul id={listId} className="m-0 list-none divide-y p-0">
        {(all ? items : items.slice(0, SHOWN)).map(i => <Row key={i.key} item={i} now={now} onClick={go(i)} />)}
      </ul>
      {items.length > SHOWN && (
        <Button variant="ghost" size="sm" className="w-full justify-start rounded-none border-t text-xs text-muted-foreground"
          onClick={() => setAll(v => !v)} aria-expanded={all} aria-controls={listId}>
          {all ? '접기' : `${items.length - SHOWN}건 더 보기`}
        </Button>
      )}
    </section>
  );
}

const sumCost = (ss: Session[]) => (ss.some(s => s.cost != null) ? ss.reduce((a, s) => a + (s.cost ?? 0), 0) : null);

/** One small summary line: open sessions, working, waiting, cost, tokens. */
export function SummaryLine() {
  const { sessions } = useScoped();
  const c: Record<string, number> = {};
  for (const s of sessions) { const st = stateOf(s); c[st] = (c[st] ?? 0) + 1; }
  const items: [string, string | number][] = [
    ['열린 세션', `${sessions.filter(isOpen).length}/${sessions.length}`],
    ['작업 중', c.working ?? 0],
    ['사람 기다림', c.waiting ?? 0],
    ['비용 (API 환산)', fmtUsd(sumCost(sessions) ?? 0)],
    ['토큰', fmtK(sessions.reduce((a, s) => a + totalTok(s.usage), 0))],
  ];
  return (
    <p aria-label="요약" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([k, v]) => <span key={k} className="whitespace-nowrap">{k} <span className="font-medium text-foreground tabular-nums">{v}</span></span>)}
    </p>
  );
}
