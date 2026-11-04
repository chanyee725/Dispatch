import { useMemo, useState } from "react";
import { GitBranch, Plus, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Meter, ModelTag, Stat, StatusBadge, ThinkingLine } from "@/components/bits";
import { turn } from "@/lib/turn";
import { fmtK, fmtUsd, isOpen, pct, roleColor, totalTok } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ModelBreakdown } from "@/components/ModelBreakdown";
import { useApp } from "@/store";
import type { Session, Status } from "@/types";

const FILTERS: { id: "all" | Status; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "running", label: "실행 중" },
  { id: "waiting", label: "승인 대기" },
  { id: "idle", label: "대기" },
  { id: "done", label: "완료" },
  { id: "error", label: "오류" },
];

const sumCost = (ss: Session[]) => (ss.some(s => s.cost != null) ? ss.reduce((a, s) => a + (s.cost ?? 0), 0) : null);

function SessionCard({ s, parent, onOpen }: { s: Session; parent?: Session; onOpen: () => void }) {
  const ctx = s.ctxWindow ? s.ctx / s.ctxWindow : 0;
  const waiting = s.status === "waiting";
  const live = s.status === "running" || s.status === "starting";
  return (
    <button
      onClick={onOpen}
      title={parent ? `${parent.name}이(가) 만든 세션` : undefined}
      className={cn(
        "group flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        (waiting || s.stall) && "border-warn/60 bg-warn/5",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-sm font-semibold">{s.name}</span>
        <ModelTag provider={s.provider} label={`${s.modelLabel}${s.effort ? ` ${s.effort}` : ""}`} className="min-w-0" />
        <StatusBadge status={s.status} className="ml-auto" />
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
          {waiting && <ShieldAlert className="mr-1 inline size-3.5 -translate-y-px text-warn" />}
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

export function SessionsPage({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) {
  const sessions = useApp(s => s.sessions);
  const roles = useApp(s => s.roles);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [breakdown, setBreakdown] = useState(false);

  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: sessions.length };
    for (const s of sessions) c[s.status] = (c[s.status] ?? 0) + 1;
    c.running = (c.running ?? 0) + (c.starting ?? 0);
    return c;
  }, [sessions]);
  const list = useMemo(
    () => [...sessions]
      .filter(s => filter === "all" || s.status === filter || (filter === "running" && s.status === "starting"))
      .sort((a, b) => b.startedAt - a.startedAt),
    [sessions, filter],
  );

  const open = sessions.filter(isOpen);
  const total = sessions.reduce((a, s) => a + totalTok(s.usage), 0);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 p-6 max-md:p-4">
      <section className="grid grid-cols-5 gap-3 max-xl:grid-cols-3 max-sm:grid-cols-2" aria-label="요약">
        <Stat strong label="열린 세션" value={open.length} hint={`전체 ${sessions.length}개`} />
        <Stat label="실행 중" value={counts.running ?? 0} hint="응답을 만드는 중" />
        <Stat label="승인 대기" value={counts.waiting ?? 0} hint={counts.waiting ? "확인이 필요해요" : "대기 중인 요청 없음"} />
        <Stat label="비용 (API 환산)" value={fmtUsd(sumCost(sessions) ?? 0)} hint="모델별로 보기" onClick={() => setBreakdown(true)} />
        <Stat label="토큰" value={fmtK(total)} hint="입력 + 캐시 + 출력" onClick={() => setBreakdown(true)} />
      </section>
      <ModelBreakdown sessions={sessions} open={breakdown} onOpenChange={setBreakdown} />

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
          <p className="font-medium">아직 세션이 없어요</p>
          <p className="max-w-md text-sm text-muted-foreground">역할과 모델을 골라 여러 세션을 한 번에 시작할 수 있어요. 관리자 세션은 필요한 세션을 직접 만들기도 해요.</p>
          <Button onClick={onCreate} className="mt-2"><Plus />새 세션</Button>
        </div>
      ) : (
        <>
          <Tabs value={filter} onValueChange={v => setFilter(v as typeof filter)} className="max-w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
            <TabsList>
              {FILTERS.map(f => (
                <TabsTrigger key={f.id} value={f.id} className="gap-1.5">
                  {f.label}
                  <span className="num text-xs text-muted-foreground">{counts[f.id] ?? 0}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {list.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">이 상태의 세션이 없어요.</p>}

          <div className="flex flex-col gap-8">
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
                    {ss.map(s => <SessionCard key={s.id} s={s} parent={s.parent ? byId.get(s.parent) : undefined} onOpen={() => onOpen(s.id)} />)}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
