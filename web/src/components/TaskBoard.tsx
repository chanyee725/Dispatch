import { useEffect, useMemo, useState } from "react";
import { ChevronRight, CircleCheck, ListChecks, Ticket as TicketIcon, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api, useApp, type BoardTask, type TaskStage, type Ticket } from "@/store";
import type { Session } from "@/types";
import { STEPS, lastStep, stepIndex, stepStates, type StepState } from "@/lib/steps";

const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`);

function useNow(ms = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** Time spent in each stage (ms), summed over revisits; the open stage runs up to `now`. */
function stageTimes(t: BoardTask, now: number) {
  const h = t.stages?.length ? t.stages : [{ stage: t.stage, at: t.stageAt ?? t.createdAt }];
  const out: Partial<Record<TaskStage, number>> = {};
  h.forEach((e, i) => {
    const end = i + 1 < h.length ? h[i + 1].at : e.stage === "done" ? e.at : now;
    out[e.stage] = (out[e.stage] ?? 0) + Math.max(0, end - e.at);
  });
  return out;
}

const STEP_CLASS: Record<StepState, string> = {
  done: "bg-ok",
  current: "bg-[var(--role-impl)]",
  blocked: "bg-warn",
  skipped: "border border-dashed border-muted-foreground/40",
  todo: "bg-muted",
};

/** Five cells, one per stage, filled by progress; the time spent in each stage is in the tooltip. */
function Stepper({ t, now }: { t: BoardTask; now: number }) {
  const stage = t.stage;
  const at = stepIndex(lastStep(t));
  const times = stageTimes(t, now);
  const known = (t.stages?.length ?? 0) > 0;
  const states = stepStates(t);
  return (
    <ol className="flex items-center gap-1" aria-label={`단계: ${stage === "blocked" ? "막힘" : STEPS[at]?.label ?? stage}`}>
      {STEPS.map((s, i) => {
        const state = states[i];
        const m = mins(times[s.id] ?? 0);
        const time = known ? ` ${m < 1 ? "1분 미만" : fmtMin(m)}` : "";
        const title =
          state === "skipped" ? `${s.label} 거치지 않음` : state === "todo" ? `${s.label} 아직` : `${s.label}${time}`;
        return <li key={s.id} title={title} data-state={state} className={cn("h-1.5 w-6 rounded-full", STEP_CLASS[state])} />;
      })}
    </ol>
  );
}

/** "예상 20분 → 34분째 (+14분) · 테스트 단계 12분째"; `over` is the minutes past the estimate. */
function timing(t: BoardTask, now: number) {
  const inStage = mins(now - t.stageAt);
  const stageLabel = t.stage === "blocked" ? "막힌 지" : `${STEPS[stepIndex(t.stage)]?.label ?? t.stage} 단계`;
  const stagePart = `${stageLabel} ${fmtMin(inStage)}째`;
  if (t.etaAt == null) return { text: `예상 없음 · ${stagePart}`, over: 0 };
  const planned = mins(t.etaAt - t.createdAt);
  const spent = mins(now - t.createdAt);
  const over = t.etaAt < now ? Math.max(1, mins(now - t.etaAt)) : 0;
  return { text: `예상 ${fmtMin(planned)} → ${fmtMin(spent)}째${over ? ` (+${fmtMin(over)})` : ""} · ${stagePart}`, over };
}

/** Sessions named in a task's owner text ("Remy", "Hana · Zed"). */
function ownersOf(t: BoardTask, sessions: Session[]) {
  const owner = t.owner ?? "";
  if (!owner) return [];
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sessions.filter(s => s.status !== "done" && new RegExp(`(^|[^\\p{L}\\d])${esc(s.name)}($|[^\\p{L}\\d])`, "u").test(owner));
}

// Long-running checks deserve a look sooner than ordinary edits.
const SLOW_AFTER = (label: string) => (/e2e|테스트|빌드|타입|lint/.test(label) ? 5 : 10);

/** "Remy · e2e 실행 · 4분째" under a task; amber once it has gone on too long. */
function Activity({ owners, now }: { owners: Session[]; now: number }) {
  const busy = owners.filter(s => s.activity);
  if (!busy.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap gap-x-3 text-xs">
      {busy.map(s => {
        const a = s.activity!;
        const m = mins(now - a.since);
        return (
          <span key={s.id} className={cn("num truncate", m >= SLOW_AFTER(a.label) ? "text-warn" : "text-muted-foreground")}>
            <span className="font-medium text-foreground">{s.name}</span> · {a.label}
            {m > 0 ? ` · ${fmtMin(m)}째` : ""}
          </span>
        );
      })}
    </div>
  );
}

function Row({ t, lead, owners, now, onOpen }: { t: BoardTask; lead?: string; owners: Session[]; now: number; onOpen?: () => void }) {
  const done = t.stage === "done";
  const left = t.etaAt ? mins(t.etaAt - now) : null;
  const time = done ? null : timing(t, now);
  const label = done ? "완료" : t.stage === "blocked" ? "막힘" : STEPS[stepIndex(t.stage)]?.label ?? t.stage;
  return (
    <li
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={e => { if (onOpen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      title={onOpen ? "세션 열기" : undefined}
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-0.5 px-3 py-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-2",
        onOpen && "cursor-pointer hover:bg-accent/50",
        done && "text-muted-foreground",
      )}
    >
      <div className="min-w-0 max-sm:col-span-2">
        <div className="flex min-w-0 items-center gap-2">
          {done ? <CircleCheck className="size-3.5 shrink-0 text-ok" /> : t.stage === "blocked" ? <TriangleAlert className="size-3.5 shrink-0 text-warn" /> : null}
          <span className={cn("truncate text-sm font-medium", done && "line-through")}>{t.title}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {[lead, t.owner, t.note].filter(Boolean).join(" · ") || " "}
        </div>
        {time && <div className={cn("num truncate text-xs", time.over ? "text-warn" : "text-muted-foreground")}>{time.text}</div>}
        {!done && <Activity owners={owners} now={now} />}
      </div>
      <div className="flex flex-col items-end gap-1 max-sm:items-start">
        <Stepper t={t} now={now} />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="flex w-24 items-center justify-end gap-1">
        <span className={cn("num text-right text-sm", time?.over ? "text-warn" : done ? "text-muted-foreground" : "font-semibold")}>
          {done ? "완료" : left == null ? "?" : time?.over ? `+${fmtMin(time.over)}` : `${fmtMin(left)} 남음`}
        </span>
        <button
          aria-label="보드에서 지우기"
          title="보드에서 지우기"
          onClick={e => { e.stopPropagation(); api("POST", `/api/tasks/${t.id}/remove`).catch(() => {}); }}
          className="grid size-5 cursor-pointer place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent focus-visible:opacity-100 max-sm:opacity-100"
        >
          <X className="size-3" />
        </button>
      </div>
    </li>
  );
}

function useBoard() {
  const tasks = useApp(s => s.tasks ?? []);
  const now = useNow();
  const active = tasks.filter(t => t.stage !== "done");
  // Overdue work is counted apart; it would otherwise read as "0분 남음".
  const etas = active.map(t => t.etaAt).filter((x): x is number => x != null && x > now);
  const late = active.filter(t => t.etaAt != null && t.etaAt <= now).length;
  return {
    tasks, active, now, late,
    first: etas.length ? mins(Math.min(...etas) - now) : null,
    last: etas.length ? mins(Math.max(...etas) - now) : null,
  };
}

const until = (t: number | null, now: number) => (t ? fmtMin(mins(t - now)) : "?");

/** Tickets saved at the usage limit: what was left per lead, resumed after the reset. */
function Tickets({ tickets, now }: { tickets: Ticket[]; now: number }) {
  const open = tickets.filter(t => t.status === "open");
  const past = tickets.length - open.length;
  // Only tickets still waiting matter; old resumed/closed ones alone would sit above the
  // live task list and read as if those tasks were past tickets.
  if (!open.length) return null;
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><TicketIcon className="size-4" />티켓</h3>
      {open.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {open.map(t => (
            <li key={t.id} className="flex min-w-0 flex-col gap-1 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="shrink-0 font-medium">{t.leadName ?? "관리자"}</span>
                <span className="truncate text-xs text-muted-foreground">{t.reason} · 작업 {t.items.length}개</span>
                <span className="num ml-auto shrink-0 text-xs text-muted-foreground">초기화까지 {until(t.resetAt, now)}</span>
              </div>
              {t.items.length > 0 && (
                <p className="truncate text-xs text-muted-foreground">{t.items.map(i => i.title).join(" · ")}</p>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => api("POST", `/api/tickets/${t.id}/resume`).catch(() => {})}>지금 재개</Button>
                <Button size="sm" variant="ghost" onClick={() => api("POST", `/api/tickets/${t.id}/close`).catch(() => {})}>닫기</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {past > 0 && <p className="text-xs text-muted-foreground">지난 티켓 {past}개 (재개·종료됨)</p>}
    </section>
  );
}

/** "작업 n · ~m분" button at the right of the filter row; opens the board in a dialog. */
export function TaskBoardButton({ onOpen }: { onOpen?: (id: string) => void }) {
  const { tasks, active, now, late, first, last } = useBoard();
  const tickets = useApp(s => s.tickets ?? []);
  const openTickets = tickets.filter(t => t.status === "open").length;
  const sessions = useApp(s => s.sessions);
  const names = useMemo(() => new Map(sessions.map(s => [s.id, s.name])), [sessions]);
  const [open, setOpen] = useState(false);
  // The row opens its owner's session (a name such as "Remy" in the owner text), else the lead's.
  const target = (t: BoardTask) => ownersOf(t, sessions)[0]?.id || t.lead || null;
  // Finished work stays folded to its count; only what is still moving is spelled out.
  const [showDone, setShowDone] = useState(false);
  const finished = tasks.filter(t => t.stage === "done");
  const row = (t: BoardTask) => (
    <Row
      key={t.id}
      t={t}
      lead={t.lead ? names.get(t.lead) : undefined}
      owners={ownersOf(t, sessions)}
      now={now}
      onOpen={onOpen && target(t) ? () => { setOpen(false); onOpen(target(t)!); } : undefined}
    />
  );
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="shrink-0 gap-2">
        <ListChecks />
        작업
        <span className="num text-xs text-muted-foreground">
          {active.length}
          {first != null ? ` · ${fmtMin(first)} 남음` : ""}
        </span>
        {late > 0 && <span className="num text-xs text-warn">예상 넘김 {late}</span>}
        {openTickets > 0 && (
          <span className="num rounded-full bg-warn/15 px-1.5 text-xs text-warn" title="한도로 멈춘 티켓">티켓 {openTickets}</span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>작업</DialogTitle>
            <DialogDescription className="num">
              진행 중 {active.length}
              {first != null ? ` · 가장 빠른 완료까지 ${fmtMin(first)}` : ""}
              {last != null && last !== first ? ` · 전부 끝나기까지 ${fmtMin(last)}` : ""}
              {late > 0 ? ` · 예상을 넘긴 작업 ${late}개` : ""}
            </DialogDescription>
          </DialogHeader>
          <Tickets tickets={tickets} now={now} />
          {tasks.length ? (
            <div className="flex max-h-[60vh] min-h-0 flex-col gap-2 overflow-y-auto">
              {active.length > 0 && (
                <ul className="divide-y rounded-lg border">
                  {active.map(row)}
                </ul>
              )}
              {finished.length > 0 && (
                <>
                  <button
                    onClick={() => setShowDone(v => !v)}
                    aria-expanded={showDone}
                    className="flex cursor-pointer items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <ChevronRight className={cn("size-3.5 transition-transform", showDone && "rotate-90")} />
                    <span className="num">완료 {finished.length}개</span>
                  </button>
                  {showDone && (
                    <ul className="divide-y rounded-lg border">
                      {finished.map(row)}
                    </ul>
                  )}
                </>
              )}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">관리자가 올린 작업이 없어요</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
