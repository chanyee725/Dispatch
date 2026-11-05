import { useEffect } from "react";
import { X } from "lucide-react";
import { AttentionStrip } from "@/components/AttentionStrip";
import { Metric, StateMark } from "@/components/monitor";
import { isOpen, roleColor, stateOf } from "@/lib/format";
import { useApp } from "@/store";
import type { Session, SessionState } from "@/types";

/** Needs-a-person states first. Order inside a group is fixed (start time, then id), so tiles only move when a state changes. */
const RANK: Record<SessionState, number> = { failed: 0, stuck: 1, waiting: 2, working: 3, resting: 4, done: 5 };

/** Always-on screen: dark monitor look, big state grid + attention area only. No auto-scroll, no motion. Open with `#tv`. */
export function TvView({ onExit, onOpen }: { onExit: () => void; onOpen: (id: string) => void }) {
  const sessions = useApp(s => s.sessions);
  const project = useApp(s => s.project);

  // Force the dark monitor look while mounted, then put the user's theme back.
  useEffect(() => {
    const root = document.documentElement;
    const before = [root.classList.contains("dark"), root.classList.contains("monitor")];
    root.classList.add("dark", "monitor");
    return () => { root.classList.toggle("dark", before[0]); root.classList.toggle("monitor", before[1]); };
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onExit();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onExit]);

  const list = sessions.filter(isOpen).concat(sessions.filter(s => !isOpen(s)))
    .sort((a, b) => RANK[stateOf(a)] - RANK[stateOf(b)] || a.startedAt - b.startedAt || a.id.localeCompare(b.id));

  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-4 overflow-y-auto bg-background p-6 text-foreground max-md:p-4">
      <header className="flex items-center gap-4">
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{project.name || "Dispatch"}</h1>
        <Metric className="text-right" label="열린 세션" value={sessions.filter(isOpen).length} />
        <button onClick={onExit} aria-label="상시 화면 닫기" title="닫기 (Esc)"
          className="flex size-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <X className="size-4" />
        </button>
      </header>

      <AttentionStrip onOpen={onOpen} />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {list.map(s => <Tile key={s.id} s={s} />)}
      </div>
    </div>
  );
}

function Tile({ s }: { s: Session }) {
  const st = stateOf(s);
  return (
    <div className="flex min-h-28 min-w-0 flex-col justify-between gap-3 rounded-[var(--radius)] border border-l-4 bg-card p-4" style={{ borderLeftColor: roleColor(s.role) }}>
      <div className="min-w-0">
        <div className="truncate text-lg font-semibold">{s.name}</div>
        <div className="truncate text-sm text-muted-foreground">{s.roleName}</div>
      </div>
      <StateMark state={st} size="lg" />
    </div>
  );
}
