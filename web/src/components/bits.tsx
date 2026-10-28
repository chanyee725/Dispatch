import { cn } from "@/lib/utils";
import { LEVEL_COLOR, STATUS, level } from "@/lib/format";
import type { Status } from "@/types";

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const s = STATUS[status] ?? STATUS.idle;
  const live = status === "running" || status === "starting";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-foreground/80", className)}>
      <span className="relative flex size-1.5">
        {live && <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: s.color }} />}
        <span className="relative inline-flex size-1.5 rounded-full" style={{ background: s.color }} />
      </span>
      {s.label}
    </span>
  );
}

// Thin usage bar whose colour follows the ok / warn / bad thresholds.
export function Meter({ value, className, color }: { value: number | null; className?: string; color?: string }) {
  const v = Math.min(1, Math.max(0, value ?? 0));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${v * 100}%`, background: color ?? LEVEL_COLOR[level(value)] }} />
    </div>
  );
}

export function Stat({ label, value, hint, strong }: { label: string; value: string | number; hint?: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl border px-4 py-3.5", strong ? "border-transparent bg-primary text-primary-foreground" : "bg-card")}>
      <div className={cn("text-[13px]", strong ? "text-primary-foreground/70" : "text-muted-foreground")}>{label}</div>
      <div className="num mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className={cn("mt-0.5 truncate text-xs", strong ? "text-primary-foreground/60" : "text-muted-foreground")}>{hint}</div>}
    </div>
  );
}
