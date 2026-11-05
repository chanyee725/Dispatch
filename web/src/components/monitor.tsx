import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/bits";
import type { SessionState } from "@/types";

/**
 * Building blocks for dense, monitoring-style screens. They read the theme tokens, so they look right in every
 * theme (and tightest in the "모니터링" theme).
 *
 *   <Panel title="확인 필요" aside={<span className="num">3</span>}>…</Panel>
 *   <Metric label="열린 세션" value={4} tone="warn" size="lg" />
 *   <StateMark state={session.state} />            // shape + colour + label; size="lg" for TV grids
 */

/** Flat panel: thin border, small title row, body below. `aside` sits at the right of the title row. */
export function Panel({ title, aside, children, className, bodyClassName }: {
  title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-[var(--radius)] border bg-card", className)}>
      <header className="flex h-8 items-center gap-2 border-b bg-muted/40 px-3 text-xs font-medium text-muted-foreground">
        <h3 className="min-w-0 flex-1 truncate font-medium">{title}</h3>
        {aside}
      </header>
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

const TONE: Record<"ok" | "warn" | "bad" | "idle", string> = {
  ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", idle: "var(--idle)",
};

/**
 * Big number with a small label. Only give `tone` (and `size="lg"`) to numbers that need action; a tone is a
 * status colour, so pair it with a label or hint that says what it means. Width is stable: tabular numbers.
 */
export function Metric({ label, value, hint, tone, size = "md", className }: {
  label: string; value: string | number; hint?: string; tone?: keyof typeof TONE; size?: "md" | "lg"; className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div
        className={cn("num font-semibold tracking-tight", size === "lg" ? "text-4xl leading-tight" : "text-2xl leading-snug")}
        style={tone ? { color: TONE[tone] } : undefined}
      >
        {value}
      </div>
      {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Session state as shape + colour + label (never colour alone). `lg` is the oversized form for always-on screens. */
export function StateMark({ state, size = "md", className }: { state: SessionState; size?: "md" | "lg"; className?: string }) {
  return (
    <StatusBadge
      state={state}
      className={cn(size === "lg" && "gap-2 border-0 p-0 text-xl font-semibold text-foreground [&_svg]:size-6", className)}
    />
  );
}
