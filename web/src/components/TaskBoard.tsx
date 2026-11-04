import { useEffect, useMemo, useState } from "react";
import { CircleCheck, ListChecks, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api, useApp, type BoardTask, type TaskStage } from "@/store";

const STEPS: { id: TaskStage; label: string }[] = [
  { id: "plan", label: "계획" },
  { id: "impl", label: "구현" },
  { id: "review", label: "리뷰" },
  { id: "test", label: "테스트" },
  { id: "merge", label: "병합" },
];
const stepIndex = (s: TaskStage) => STEPS.findIndex(x => x.id === s);

const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`);

function useNow(ms = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function Stepper({ stage }: { stage: TaskStage }) {
  const at = stepIndex(stage);
  return (
    <ol className="flex items-center gap-1" aria-label={`단계: ${STEPS[at]?.label ?? stage}`}>
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1">
          <span
            title={s.label}
            className={cn(
              "h-1.5 w-5 rounded-full",
              stage === "done" || i < at ? "bg-ok" : i === at ? (stage === "blocked" ? "bg-warn" : "bg-[var(--role-impl)]") : "bg-muted",
            )}
          />
        </li>
      ))}
    </ol>
  );
}

function Row({ t, lead, now }: { t: BoardTask; lead?: string; now: number }) {
  const done = t.stage === "done";
  const left = t.etaAt ? mins(t.etaAt - now) : null;
  const over = t.etaAt != null && t.etaAt < now && !done;
  const label = done ? "완료" : t.stage === "blocked" ? "막힘" : STEPS[stepIndex(t.stage)]?.label ?? t.stage;
  return (
    <li className={cn("group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-0.5 px-3 py-2", done && "opacity-60")}>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {done ? <CircleCheck className="size-3.5 shrink-0 text-ok" /> : t.stage === "blocked" ? <TriangleAlert className="size-3.5 shrink-0 text-warn" /> : null}
          <span className={cn("truncate text-sm font-medium", done && "line-through")}>{t.title}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {[lead, t.owner, t.note].filter(Boolean).join(" · ") || " "}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Stepper stage={t.stage} />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="flex w-24 items-center justify-end gap-1">
        <span className={cn("num text-right text-sm", over ? "text-warn" : done ? "text-muted-foreground" : "font-semibold")}>
          {done ? "완료" : left == null ? "?" : over ? "지연" : `${fmtMin(left)} 남음`}
        </span>
        <button
          aria-label="보드에서 지우기"
          title="보드에서 지우기"
          onClick={() => api("POST", `/api/tasks/${t.id}/remove`).catch(() => {})}
          className="hidden size-5 place-items-center rounded text-muted-foreground hover:bg-accent group-hover:grid"
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
  const etas = active.map(t => t.etaAt).filter((x): x is number => x != null);
  return {
    tasks, active, now,
    first: etas.length ? mins(Math.min(...etas) - now) : null,
    last: etas.length ? mins(Math.max(...etas) - now) : null,
  };
}

/** "작업 n · ~m분" button at the right of the filter row; opens the board in a dialog. */
export function TaskBoardButton() {
  const { tasks, active, now, first, last } = useBoard();
  const sessions = useApp(s => s.sessions);
  const names = useMemo(() => new Map(sessions.map(s => [s.id, s.name])), [sessions]);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="shrink-0 gap-2">
        <ListChecks />
        작업
        <span className="num text-xs text-muted-foreground">
          {active.length}
          {first != null ? ` · ${fmtMin(first)} 남음` : ""}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>작업</DialogTitle>
            <DialogDescription className="num">
              진행 중 {active.length}
              {first != null ? ` · 가장 빠른 완료까지 ${fmtMin(first)}` : ""}
              {last != null && last !== first ? ` · 전부 끝나기까지 ${fmtMin(last)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {tasks.length ? (
            <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-lg border">
              {[...active, ...tasks.filter(t => t.stage === "done")].map(t => (
                <Row key={t.id} t={t} lead={t.lead ? names.get(t.lead) : undefined} now={now} />
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">관리자가 올린 작업이 없어요</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
