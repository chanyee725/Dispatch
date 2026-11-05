import { useEffect, useMemo, useState } from "react";
import { ChartGantt, GitBranch, LayoutGrid, Plus, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Meter, ModelTag, StatusBadge, ThinkingLine } from "@/components/bits";
import { AttentionStrip, SummaryLine } from "@/components/AttentionStrip";
import { turn } from "@/lib/turn";
import { elapsed } from "@/lib/attention";
import { byUrgency, stateStart } from "@/lib/order";
import { fmtK, fmtUsd, isOpen, pct, roleColor, stateOf, totalTok } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ModelBreakdown } from "@/components/ModelBreakdown";
import { TaskBoardButton } from "@/components/TaskBoard";
import { SessionTimeline } from "@/components/SessionTimeline";
import { useApp } from "@/store";
import type { Session, SessionState } from "@/types";

const FILTERS: { id: "all" | SessionState; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "working", label: "작업 중" },
  { id: "waiting", label: "사람 기다림" },
  { id: "stuck", label: "멈춤" },
  { id: "failed", label: "실패" },
  { id: "resting", label: "쉼" },
  { id: "done", label: "완료" },
];

type View = "cards" | "timeline";
const VIEW_KEY = "dispatch.boardView";

/** 카드 ⇄ 타임라인 switch; the choice is remembered in this browser. */
function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const opts: { id: View; label: string; Icon: typeof LayoutGrid }[] = [
    { id: "cards", label: "카드", Icon: LayoutGrid },
    { id: "timeline", label: "타임라인", Icon: ChartGantt },
  ];
  return (
    <div role="radiogroup" aria-label="보기 방식" className="inline-flex shrink-0 rounded-lg bg-muted p-[3px]">
      {opts.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={view === id}
          onClick={() => onChange(id)}
          className={cn(
            "inline-flex h-[calc(2.25rem-6px)] cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            view === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
          <span className="max-sm:sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}

const sumCost = (ss: Session[]) => (ss.some(s => s.cost != null) ? ss.reduce((a, s) => a + (s.cost ?? 0), 0) : null);

function SessionCard({ s, parent, now, onOpen }: { s: Session; parent?: Session; now: number; onOpen: () => void }) {
  const ctx = s.ctxWindow ? s.ctx / s.ctxWindow : 0;
  const state = stateOf(s);
  const asking = s.pending.length > 0 || s.status === "waiting";
  const live = s.status === "running" || s.status === "starting";
  const since = elapsed(stateStart(s, state), now);
  return (
    <button
      onClick={onOpen}
      title={parent ? `${parent.name}이(가) 만든 세션` : undefined}
      className={cn(
        "group flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        (state === "waiting" || state === "stuck" || s.stall) && "border-warn/60 bg-warn/5",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-sm font-semibold">{s.name}</span>
        <ModelTag provider={s.provider} label={`${s.modelLabel}${s.effort ? ` ${s.effort}` : ""}`} className="min-w-0" />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="num text-[11px] text-muted-foreground" title="이 상태가 된 뒤 지난 시간">{since ? `${since}째` : "방금"}</span>
          <StatusBadge state={state} />
        </span>
      </div>

      {s.stall && (
        <div className="flex items-start gap-1.5 text-xs text-foreground">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" />
          <span className="line-clamp-1">{s.stall.reason}</span>
        </div>
      )}

      {live ? (
        <ThinkingLine status={s.status} turnStartedAt={turn(s).at} tokens={turn(s).tokens} />
      ) : (
        <p className={cn("line-clamp-1 text-[13px] leading-5", s.error ? "text-bad" : "text-muted-foreground")}>
          {asking && <ShieldAlert className="mr-1 inline size-3.5 -translate-y-px text-warn" />}
          {s.error || s.last || "첫 응답을 기다리는 중이에요"}
        </p>
      )}

      <div className="num flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        {s.branch && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{s.branch}</span>
          </span>
        )}
        <span className="ml-auto shrink-0">{fmtK(totalTok(s.usage))}</span>
        <span className="flex shrink-0 items-center gap-1" title={`컨텍스트 ${pct(ctx)}`}>
          <Meter value={ctx} className="h-1 w-10" />
          {pct(ctx)}
        </span>
      </div>
    </button>
  );
}

export function SessionsPage({ onOpen, onCreate, onUsage }: { onOpen: (id: string) => void; onCreate: () => void; onUsage?: () => void }) {
  const sessions = useApp(s => s.sessions);
  const roles = useApp(s => s.roles);
  const [filter, setFilter] = useState<"all" | SessionState>("all");
  const [breakdown, setBreakdown] = useState(false);
  const [showDone, setShowDone] = useState(false);
  // "N분째" only needs minute precision.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  const [view, setViewState] = useState<View>(() => (localStorage.getItem(VIEW_KEY) === "timeline" ? "timeline" : "cards"));
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };

  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: sessions.length };
    for (const s of sessions) { const st = stateOf(s); c[st] = (c[st] ?? 0) + 1; }
    return c;
  }, [sessions]);
  // Done sessions stay out of 전체 until asked for; failed ones are not done and stay in the strip.
  const hideDone = filter === "all" && !showDone;
  const list = useMemo(
    () => byUrgency(sessions.filter(s => {
      const st = stateOf(s);
      return filter === "all" ? !(hideDone && st === "done") : st === filter;
    }), stateOf),
    [sessions, filter, hideDone],
  );
  const doneCount = counts.done ?? 0;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 p-6 max-md:p-4">
      <div className="flex flex-col gap-2">
        <AttentionStrip onOpen={onOpen} onUsage={onUsage} />
        <SummaryLine onBreakdown={() => setBreakdown(true)} />
      </div>
      <ModelBreakdown sessions={sessions} open={breakdown} onOpenChange={setBreakdown} />

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
          <p className="font-medium">아직 세션이 없어요</p>
          <p className="max-w-md text-sm text-muted-foreground">역할과 모델을 골라 여러 세션을 한 번에 시작할 수 있어요. 관리자 세션은 필요한 세션을 직접 만들기도 해요.</p>
          <Button onClick={onCreate} className="mt-2"><Plus />새 세션</Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
          <Tabs value={filter} onValueChange={v => setFilter(v as typeof filter)} className="min-w-0 max-w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
            <TabsList>
              {FILTERS.map(f => (
                <TabsTrigger key={f.id} value={f.id} className="gap-1.5">
                  {f.label}
                  <span className="num text-xs text-muted-foreground">{counts[f.id] ?? 0}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex shrink-0 items-center gap-2">
            <ViewToggle view={view} onChange={setView} />
            <TaskBoardButton onOpen={onOpen} />
          </div>
          </div>

          {list.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">{hideDone ? "열려 있는 세션이 없어요." : "이 상태의 세션이 없어요."}</p>
          )}

          {view === "timeline" && list.length > 0 && <SessionTimeline list={list} onOpen={onOpen} />}

          {view === "cards" && <div className="flex flex-col gap-8">
            {roles.map(role => {
              const ss = list.filter(s => s.role === role.id);
              if (!ss.length) return null;
              const cost = sumCost(ss);
              return (
                <section key={role.id} className="border-l-[3px] pl-4" style={{ borderColor: roleColor(role.id) }} aria-label={role.name}>
                  <header className="mb-3 flex items-baseline gap-3">
                    <h2 className="text-[15px] font-semibold">{role.name}</h2>
                    <span className="num text-sm text-muted-foreground">
                      {ss.filter(isOpen).length}개 열림 / {ss.length}개
                    </span>
                    {cost != null && <span className="num text-sm text-muted-foreground">{fmtUsd(cost)}</span>}
                  </header>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
                    {ss.map(s => <SessionCard key={s.id} s={s} parent={s.parent ? byId.get(s.parent) : undefined} now={now} onOpen={() => onOpen(s.id)} />)}
                  </div>
                </section>
              );
            })}
          </div>}

          {filter === "all" && doneCount > 0 && (
            <Button variant="ghost" size="sm" className="num cursor-pointer self-start text-muted-foreground" onClick={() => setShowDone(v => !v)}>
              {showDone ? "완료 숨기기" : `완료 ${doneCount}개 보기`}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
