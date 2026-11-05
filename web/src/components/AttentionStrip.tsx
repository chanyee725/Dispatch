import { useEffect, useId, useMemo, useState } from "react";
import { ChevronRight, CircleCheck, Clock, Gauge, GitMerge, TriangleAlert, type LucideIcon } from "lucide-react";
import { Panel, StateMark } from "@/components/monitor";
import { attentionItems, elapsed, type AttentionItem, type AttentionKind } from "@/lib/attention";
import { fmtK, fmtUsd, isOpen, roleColor, stateOf, totalTok, until } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp } from "@/store";
import type { Session } from "@/types";

/** Rows shown before "n개 더 보기"; a long strip stops being a strip. */
const SHOWN = 5;

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// Non-session rows get their own shape + label, in the StatusBadge style, so they also read without colour.
const KIND: Record<Exclude<AttentionKind, "session">, { Icon: LucideIcon; label: string }> = {
  late: { Icon: Clock, label: "지연" },
  mismatch: { Icon: TriangleAlert, label: "단계 불일치" },
  merge: { Icon: GitMerge, label: "병합 안 됨" },
  limit: { Icon: Gauge, label: "한도" },
};

function Mark({ item }: { item: AttentionItem }) {
  if (item.kind === "session") return <StateMark state={item.state ?? "stuck"} />;
  const { Icon, label } = KIND[item.kind];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border py-0.5 pr-2 pl-1.5 text-xs font-medium text-foreground/80">
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} style={{ color: `var(--${item.level})` }} />
      {label}
    </span>
  );
}

/** "8분째", "14분 지연", "2시간 뒤 초기화". */
function howLong(item: AttentionItem, now: number) {
  if (item.kind === "limit") return item.resetAt ? `${until(item.resetAt)} 뒤 초기화` : null;
  const e = elapsed(item.since, now);
  if (e == null) return null;
  if (item.kind === "late") return e ? `${e} 지연` : "막 지연됐어요";
  return e ? `${e}째` : "방금";
}

const ACTION: Record<AttentionKind, string> = { session: "열기", late: "세션 열기", mismatch: "세션 열기", merge: "관리자 열기", limit: "사용량 보기" };

function Row({ item, now, onClick }: { item: AttentionItem; now: number; onClick?: () => void }) {
  const time = howLong(item, now);
  const Box = onClick ? "button" : "div";
  return (
    <li>
      <Box
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={cn(
          "group/row grid w-full grid-cols-[6.5rem_minmax(0,10rem)_minmax(0,1fr)_7rem_5.5rem] items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left text-[13px]",
          "max-sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] max-sm:[&>[data-reason]]:col-span-3 max-sm:[&>[data-go]]:hidden",
          onClick && "cursor-pointer transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
        )}
      >
        <span className="flex min-w-0"><Mark item={item} /></span>
        <span className="flex min-w-0 items-center gap-2 font-medium">
          {item.role && <span aria-hidden className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ background: roleColor(item.role) }} />}
          <span className="truncate" title={item.who}>{item.who}</span>
        </span>
        <span data-reason className="min-w-0 truncate text-muted-foreground max-sm:order-last" title={item.reason}>{item.reason}</span>
        <span className="num shrink-0 text-right text-xs text-muted-foreground">{time}</span>
        <span data-go className={cn("inline-flex shrink-0 justify-end items-center gap-0.5 text-xs text-muted-foreground", onClick ? "group-hover/row:text-foreground" : "invisible")}>
          {ACTION[item.kind]}
          <ChevronRight aria-hidden className="size-3.5 transition-transform group-hover/row:translate-x-0.5" />
        </span>
      </Box>
    </li>
  );
}

/**
 * "확인 필요" strip at the top of 세션: sessions waiting on a person, stuck or failed, late tasks, failed
 * merge checks and usage limits from 75 %. Each row says why, for how long, and opens what to look at.
 */
export function AttentionStrip({ onOpen, onUsage }: { onOpen: (id: string) => void; onUsage?: () => void }) {
  const sessions = useApp(s => s.sessions);
  const tasks = useApp(s => s.tasks ?? []);
  const limits = useApp(s => s.limits);
  const guard = useApp(s => s.settings.guard);
  const now = useNow();
  const [all, setAll] = useState(false);
  const listId = useId();
  const go = (i: AttentionItem) =>
    i.kind === "limit" ? onUsage : i.sessionId && sessions.some(s => s.id === i.sessionId) ? () => onOpen(i.sessionId!) : undefined;
  const items = useMemo(() => attentionItems({ sessions, tasks, limits, guard, now, stateOf }), [sessions, tasks, limits, guard, now]);

  // One live region that stays mounted, so screen readers hear rows come and go (and the strip empty out).
  // Additions only: the "N분째" clock ticking every 15 s is a text change and stays quiet.
  return <div aria-live="polite" aria-relevant="additions">{items.length ? <Rows items={items} now={now} go={go} listId={listId} all={all} setAll={setAll} /> : <Empty />}</div>;
}

function Empty() {
  return (
    <div className="flex h-8 items-center gap-2 rounded-[var(--radius)] border bg-card px-3 text-xs text-muted-foreground">
      <CircleCheck aria-hidden className="size-3.5 shrink-0" style={{ color: "var(--ok)" }} />
      지금 볼 것 없어요
    </div>
  );
}

function Rows({ items, now, go, listId, all, setAll }: {
  items: AttentionItem[]; now: number; go: (i: AttentionItem) => (() => void) | undefined;
  listId: string; all: boolean; setAll: (f: (v: boolean) => boolean) => void;
}) {
  const bad = items.filter(i => i.level === "bad").length;
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <Panel
      title="확인 필요"
      aside={
        <span className="num shrink-0 text-xs">
          {bad > 0 && <span style={{ color: "var(--bad)" }}>급함 {bad} · </span>}
          <span className="text-foreground">{items.length}건</span>
        </span>
      }
      bodyClassName="p-0"
    >
      <ul id={listId} className="divide-y">
        {shown.map(i => <Row key={i.key} item={i} now={now} onClick={go(i)} />)}
      </ul>
      {items.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll(v => !v)}
          aria-expanded={all}
          aria-controls={listId}
          className="num w-full cursor-pointer border-t px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
        >
          {all ? "접기" : `${items.length - SHOWN}건 더 보기`}
        </button>
      )}
    </Panel>
  );
}

const sumCost = (ss: Session[]) => (ss.some(s => s.cost != null) ? ss.reduce((a, s) => a + (s.cost ?? 0), 0) : null);

function SumItem({ label, value }: { label: string; value: string | number }) {
  return <span className="whitespace-nowrap">{label} <span className="num font-medium text-foreground">{value}</span></span>;
}

function SumLink({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="모델별로 보기"
      className="cursor-pointer whitespace-nowrap rounded-sm underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {label} <span className="num font-medium text-foreground">{value}</span>
    </button>
  );
}

/** The five old KPI cards as one small line; cost and tokens open the model breakdown. */
export function SummaryLine({ onBreakdown }: { onBreakdown: () => void }) {
  const sessions = useApp(s => s.sessions);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of sessions) { const st = stateOf(s); c[st] = (c[st] ?? 0) + 1; }
    return c;
  }, [sessions]);
  const tokens = sessions.reduce((a, s) => a + totalTok(s.usage), 0);
  return (
    <div aria-label="요약" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <SumItem label="열린 세션" value={`${sessions.filter(isOpen).length}/${sessions.length}`} />
      <SumItem label="작업 중" value={counts.working ?? 0} />
      <SumItem label="사람 기다림" value={counts.waiting ?? 0} />
      <SumLink onClick={onBreakdown} label="비용 (API 환산)" value={fmtUsd(sumCost(sessions) ?? 0)} />
      <SumLink onClick={onBreakdown} label="토큰" value={fmtK(tokens)} />
    </div>
  );
}
