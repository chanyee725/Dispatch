import { useEffect, useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, useApp, type BranchGraph as Graph } from "@/store";

const LANE_COLORS = [
  "var(--role-impl)", "var(--role-review)", "var(--role-test)",
  "var(--role-lead)", "var(--role-design)", "var(--role-docs)",
];
const COL = 16; // px per lane
const ROW = 26; // px per commit

/** Assigns each commit a lane (column) so parents/children line up — a small git-graph layout. */
function layout(g: Graph) {
  const order = g.commits; // already newest-first, --date-order
  const index = new Map(order.map((c, i) => [c.hash, i]));
  const lanes: (string | null)[] = []; // lane -> hash it currently carries (the next commit expected there)
  const rows = order.map(c => {
    // find a lane already expecting this commit, else take a free one
    let lane = lanes.indexOf(c.hash);
    if (lane === -1) { lane = lanes.indexOf(null); if (lane === -1) lane = lanes.length; }
    lanes[lane] = null;
    // place first parent on this lane, extra parents on new lanes
    const parents = c.parents.filter(p => index.has(p));
    parents.forEach((p, k) => {
      if (k === 0) lanes[lane] = p;
      else { let l = lanes.indexOf(null); if (l === -1) l = lanes.length; lanes[l] = p; }
    });
    // keep other lanes flowing (lines passing through)
    const passing = lanes.map((h, l) => (h && l !== lane ? l : -1)).filter(l => l >= 0);
    return { c, lane, parents, passing: [...passing] };
  });
  const width = rows.reduce((m, r) => Math.max(m, r.lane + 1, ...r.passing.map(l => l + 1)), 1);
  return { rows, width };
}

export function BranchesPage({ onOpen }: { onOpen: (id: string) => void }) {
  const sessions = useApp(s => s.sessions);
  const [g, setG] = useState<Graph | null>(null);
  useEffect(() => {
    const load = () => api<Graph>("GET", "/api/branches").then(setG, () => {});
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);
  const branchSession = useMemo(() => {
    const m = new Map<string, string>();
    const id = new Map<string, string>();
    for (const s of sessions) if (s.branch && s.status !== "done") { m.set(s.branch, s.name); id.set(s.branch, s.id); }
    return { name: m, id };
  }, [sessions]);
  const activeTips = g?.tips.filter(t => t.active).length ?? 0;
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-6 max-md:p-4">
      <div className="flex items-center gap-3">
        <GitBranch className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {g ? `${g.base} + 작업 중 ${activeTips}개 · 커밋 ${g.commits.length}` : "불러오는 중…"}
        </span>
      </div>
      {g ? (
        g.commits.length
          ? <div className="rounded-xl border bg-card p-3"><GraphView g={g} branchSession={branchSession} onOpen={onOpen} /></div>
          : <p className="py-10 text-center text-sm text-muted-foreground">표시할 브랜치가 없어요</p>
      ) : null}
    </div>
  );
}

function GraphView({ g, branchSession, onOpen }: { g: Graph; branchSession: { name: Map<string, string>; id: Map<string, string> }; onOpen: (id: string) => void }) {
  const { rows, width } = useMemo(() => layout(g), [g]);
  // tip label per commit hash
  const tipsAt = new Map<string, typeof g.tips>();
  for (const t of g.tips) { const a = tipsAt.get(t.hash) ?? []; a.push(t); tipsAt.set(t.hash, a); }
  const gw = (width + 1) * COL;
  return (
    <div className="max-h-[65vh] overflow-auto">
      <div className="relative" style={{ height: rows.length * ROW }}>
        {/* edges */}
        <svg className="absolute top-0 left-0" width={gw} height={rows.length * ROW} aria-hidden>
          {rows.map((r, i) =>
            r.parents.map((p, k) => {
              const pi = rows.findIndex(x => x.c.hash === p);
              if (pi < 0) return null;
              const x1 = (r.lane + 1) * COL, y1 = i * ROW + ROW / 2;
              const x2 = (rows[pi].lane + 1) * COL, y2 = pi * ROW + ROW / 2;
              const color = LANE_COLORS[(k === 0 ? r.lane : rows[pi].lane) % LANE_COLORS.length];
              return <path key={`${i}-${k}`} d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`} fill="none" stroke={color} strokeWidth="1.5" opacity="0.7" />;
            }),
          )}
        </svg>
        {/* nodes + subjects */}
        {rows.map((r, i) => {
          const tips = tipsAt.get(r.c.hash) ?? [];
          const color = LANE_COLORS[r.lane % LANE_COLORS.length];
          return (
            <div key={r.c.hash} className="absolute flex items-center" style={{ top: i * ROW, height: ROW, left: 0, right: 0 }}>
              <span className="absolute rounded-full" style={{ left: (r.lane + 1) * COL - 3, width: 7, height: 7, background: r.c.merge ? "var(--card)" : color, border: `1.5px solid ${color}` }} />
              <div className="flex min-w-0 items-center gap-2 pl-1 text-xs" style={{ marginLeft: gw }}>
                {tips.map(t => {
                  const sess = branchSession.name.get(t.branch);
                  const sid = branchSession.id.get(t.branch);
                  const label = t.base ? t.branch : t.branch.replace("dispatch/", "");
                  const tag = (
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", t.base ? "bg-primary text-primary-foreground" : t.active ? "bg-ok/15 text-ok" : "bg-muted text-muted-foreground")}>
                      {label}{t.ahead ? ` +${t.ahead}` : ""}{sess ? ` · ${sess}` : ""}
                    </span>
                  );
                  return sid
                    ? <button key={t.branch} onClick={() => onOpen(sid)} title="세션 열기" className="shrink-0 hover:brightness-110">{tag}</button>
                    : <span key={t.branch}>{tag}</span>;
                })}
                <span className="num shrink-0 text-muted-foreground">{r.c.short}</span>
                <span className="truncate text-foreground/80">{r.c.subject}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
