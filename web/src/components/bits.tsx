import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { LEVEL_COLOR, STATUS, level } from "@/lib/format";
import type { Status } from "@/types";

// Provider tag: Claude orange, GPT (Codex) black, Gemini blue. Keyed by string so a provider the
// server adds later still renders (in a neutral tone) without a type change here.
const PROVIDER_TAG: Record<string, { label: string; className: string }> = {
  claude: { label: "Claude", className: "bg-[#d97757] text-white" },
  openai: { label: "GPT", className: "bg-neutral-950 text-white ring-1 ring-white/15" },
  gemini: { label: "Gemini", className: "bg-[#1a73e8] text-white" },
};

export function ModelTag({ provider, label, className }: { provider: string; label: string; className?: string }) {
  const t = PROVIDER_TAG[provider];
  return (
    <span
      title={label}
      className={cn(
        "inline-flex max-w-full min-w-0 shrink items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-4 font-medium",
        t?.className ?? "bg-muted text-foreground",
        className,
      )}
    >
      <span className="shrink-0 font-semibold">{t?.label ?? provider}</span>
      <span className="truncate opacity-85">{label}</span>
    </span>
  );
}

// "Thinking" line like the CLIs show while a model works: a spinning glyph, a rotating verb,
// time since the turn started and the tokens used in it. Only while running/starting.
const SPIN = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const VERBS = [
  "Unraveling", "Pondering", "Synthesizing", "Untangling", "Percolating", "Cogitating",
  "Brewing", "Mulling", "Noodling", "Deliberating", "Tinkering", "Weaving",
];

const fmtElapsed = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
};
const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export function ThinkingLine({
  status, turnStartedAt, tokens, className,
}: { status: Status; turnStartedAt?: number; tokens?: number; className?: string }) {
  const live = status === "running" || status === "starting";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(t);
  }, [live]);
  if (!live) return null;
  const start = turnStartedAt ?? now;
  const tick = Math.floor(now / 120);
  // A new verb every 4 s, picked from the turn start so it does not jump on re-render.
  const verb = VERBS[(Math.floor((now - start) / 4000) + Math.floor(start / 1000)) % VERBS.length];
  return (
    <div role="status" aria-live="off" className={cn("flex min-w-0 items-center gap-2 text-[13px]", className)}>
      <span aria-hidden className="w-3 shrink-0 text-center text-[#d97757] motion-reduce:hidden">{SPIN[tick % SPIN.length]}</span>
      <span className="shrink-0 font-medium text-[#d97757]">{verb}…</span>
      <span className="num truncate text-muted-foreground">
        ({fmtElapsed(now - start)}{tokens != null && tokens > 0 ? ` · ↓ ${fmtTok(tokens)} tokens` : ""})
      </span>
    </div>
  );
}

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
