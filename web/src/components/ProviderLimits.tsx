import { useEffect, useState } from "react";
import { Meter } from "@/components/bits";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pct, until } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api, useApp } from "@/store";

type Window = { label: string; used: number | null; reset: number | null };
type Limits = {
  claude: { windows: Window[] };
  fable?: { windows: Window[] } | null;
  openai: { windows: Window[]; plan: string | null } | null;
  gemini: { reached: boolean; reset: number | null };
};

const DOT: Record<string, string> = { claude: "bg-[#d97757]", fable: "bg-[#d97757] ring-1 ring-[#d97757]/40 ring-offset-1 ring-offset-background", openai: "bg-neutral-950 ring-1 ring-foreground/25", gemini: "bg-[#1a73e8]" };
const NAME: Record<string, string> = { claude: "Claude", fable: "Fable", openai: "GPT", gemini: "Gemini" };

function Group({ id, children, tip }: { id: string; children: React.ReactNode; tip: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <span className={cn("size-1.5 shrink-0 rounded-full", DOT[id])} aria-hidden />
          <span className="text-xs text-muted-foreground">{NAME[id]}</span>
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

function Bars({ windows }: { windows: Window[] }) {
  return (
    <div className="flex items-center gap-2">
      {windows.map(w => (
        <div key={w.label} className="flex w-9 flex-col gap-0.5" aria-label={`${w.label} ${pct(w.used)}`}>
          <span className="num text-right text-[11px] leading-3 font-medium">{pct(w.used)}</span>
          <Meter value={w.used} className="h-[3px]" />
        </div>
      ))}
    </div>
  );
}

const resets = (ws: Window[]) => ws.map(w => `${w.label} ${pct(w.used)} · 초기화까지 ${until(w.reset)}`).join("\n");

/** One compact block per connected provider: Claude and GPT windows as bars, Gemini as ok/reached. */
export function ProviderLimits() {
  const providers = useApp(s => s.providers);
  const tick = useApp(s => s.limits.updatedAt);
  const [l, setL] = useState<Limits | null>(null);
  useEffect(() => {
    const load = () => api<Limits>("GET", "/api/limits").then(setL, () => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [tick]);
  if (!l) return null;
  const on = (id: string) => (providers as Record<string, { installed?: boolean }>)[id]?.installed;
  return (
    <div className="flex items-center gap-1 max-md:w-full max-md:flex-wrap">
      {on("claude") && (
        <Group id="claude" tip={<span className="whitespace-pre">{l.claude.windows.some(w => w.used != null) ? resets(l.claude.windows) : "Claude 세션을 한 번 실행하면 표시돼요"}</span>}>
          <Bars windows={l.claude.windows} />
        </Group>
      )}
      {on("claude") && l.fable && (
        <Group id="fable" tip={<span className="whitespace-pre">{`${resets(l.fable.windows)}\nFable 모델만 따로 세는 주간 한도예요`}</span>}>
          <Bars windows={l.fable.windows} />
        </Group>
      )}
      {on("openai") && (
        <Group id="openai" tip={<span className="whitespace-pre">{l.openai?.windows.length ? `${resets(l.openai.windows)}${l.openai.plan ? `\n요금제 ${l.openai.plan}` : ""}` : "Codex를 한 번 실행하면 표시돼요"}</span>}>
          {l.openai?.windows.length ? <Bars windows={l.openai.windows} /> : <span className="text-[11px] text-muted-foreground">—</span>}
        </Group>
      )}
      {on("gemini") && (
        <Group id="gemini" tip={l.gemini.reached ? `한도에 도달했어요 · ${l.gemini.reset ? `초기화까지 ${until(l.gemini.reset)}` : "초기화 시각 모름"}` : "Gemini는 남은 비율을 알려 주지 않아요. 한도에 걸리면 여기 표시돼요."}>
          <span className={cn("text-[11px]", l.gemini.reached ? "font-medium text-bad" : "text-muted-foreground")}>
            {l.gemini.reached ? `한도 · ${l.gemini.reset ? until(l.gemini.reset) : "도달"}` : "OK"}
          </span>
        </Group>
      )}
    </div>
  );
}
