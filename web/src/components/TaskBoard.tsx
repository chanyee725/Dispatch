import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleCheck, TriangleAlert, X } from "lucide-react";
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

function useNow(ms = 30_000) {
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
        <span className="text-[11px] text-muted-foreground">{label} · {fmtMin(mins(now - t.stageAt))}째</span>
      </div>
      <div className="flex w-20 items-center justify-end gap-1">
        <span className={cn("num text-right text-sm", over ? "text-warn" : done ? "text-muted-foreground" : "font-semibold")}>
          {done ? "—" : left == null ? "?" : over ? "지연" : `~${fmtMin(left)}`}
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

/** Leads' work items with stage, owner and time left; collapsed to a one-line summary. */
export function TaskBoard() {
  const tasks = useApp(s => s.tasks ?? []);
  const sessions = useApp(s => s.sessions);
  const now = useNow();
  const [open, setOpen] = useState(true);
  const names = useMemo(() => new Map(sessions.map(s => [s.id, s.name])), [sessions]);
  if (!tasks.length) return null;
  const active = tasks.filter(t => t.stage !== "done");
  const etas = active.map(t => t.etaAt).filter((x): x is number => x != null);
  const last = etas.length ? mins(Math.max(...etas) - now) : null;
  const first = etas.length ? mins(Math.min(...etas) - now) : null;
  return (
    <section aria-label="작업" className="rounded-xl border bg-card">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="text-[15px] font-semibold">작업</span>
        <span className="num text-sm text-muted-foreground">
          진행 중 {active.length}
          {first != null ? ` · 가장 빠른 완료 ~${fmtMin(first)}` : ""}
          {last != null && last !== first ? ` · 전부 ~${fmtMin(last)}` : ""}
        </span>
        <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <ul className="divide-y border-t">
          {[...active, ...tasks.filter(t => t.stage === "done")].map(t => (
            <Row key={t.id} t={t} lead={t.lead ? names.get(t.lead) : undefined} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}
