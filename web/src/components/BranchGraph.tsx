import { useEffect, useMemo, useState } from "react";
import { CornerDownRight, GitMerge } from "lucide-react";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api, useApp, type BranchGraph as Graph, type BranchTip } from "@/store";

// Lanes borrow the role rail colours so the graph reads in the same language as the session board.
const LANE_COLORS = [
  "var(--role-impl)", "var(--role-review)", "var(--role-test)",
  "var(--role-lead)", "var(--role-design)", "var(--role-docs)",
];
const COL = 15; // px per lane
const ROW = 30; // px per commit

/** Assigns each commit a lane so parents/children line up — a small git-graph layout. */
function layout(g: Graph) {
  const order = g.commits; // newest-first, --date-order
  const index = new Map(order.map((c, i) => [c.hash, i]));
  const lanes: (string | null)[] = [];
  const rows = order.map(c => {
    let lane = lanes.indexOf(c.hash);
    if (lane === -1) { lane = lanes.indexOf(null); if (lane === -1) lane = lanes.length; }
    lanes[lane] = null;
    const parents = c.parents.filter(p => index.has(p));
    parents.forEach((p, k) => {
      if (k === 0) lanes[lane] = p;
      else { let l = lanes.indexOf(null); if (l === -1) l = lanes.length; lanes[l] = p; }
    });
    return { c, lane, parents };
  });
  const width = rows.reduce((m, r) => Math.max(m, r.lane + 1), 1);
  const laneOf = new Map(rows.map(r => [r.c.hash, r.lane]));
  return { rows, width, laneOf };
}

type SessionMap = { name: Map<string, string>; id: Map<string, string> };

export function BranchesPage({ onOpen }: { onOpen: (id: string) => void }) {
  const sessions = useApp(s => s.sessions);
  const [g, setG] = useState<Graph | null>(null);
  useEffect(() => {
    const load = () => api<Graph>("GET", "/api/branches").then(setG, () => {});
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);
  const sess: SessionMap = useMemo(() => {
    const name = new Map<string, string>(), id = new Map<string, string>();
    for (const s of sessions) if (s.branch && s.status !== "done") { name.set(s.branch, s.name); id.set(s.branch, s.id); }
    return { name, id };
  }, [sessions]);

  const { rows, laneOf } = useMemo(() => (g ? layout(g) : { rows: [], laneOf: new Map<string, number>() }), [g]);
  const commitAt = useMemo(() => new Map((g?.commits ?? []).map(c => [c.hash, c.at])), [g]);
  const active = (g?.tips ?? []).filter(t => t.active);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 p-6 max-md:p-4">
      <header className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold tracking-tight">브랜치</h2>
        <p className="text-sm text-muted-foreground">
          {g ? <>기준 <span className="font-medium text-foreground">{g.base}</span> · 작업 중 {active.length}</> : "불러오는 중…"}
        </p>
      </header>

      {active.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 max-sm:grid-cols-1 lg:grid-cols-3">
          {active.map(t => {
            const color = LANE_COLORS[(laneOf.get(t.hash) ?? 0) % LANE_COLORS.length];
            const who = sess.name.get(t.branch);
            const sid = sess.id.get(t.branch);
            const when = commitAt.get(t.hash);
            const card = (
              <div className="flex items-center gap-3 rounded-lg border bg-card py-2.5 pr-3 pl-0 transition-colors hover:border-foreground/20">
                <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{who ?? t.branch.replace("dispatch/", "")}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {t.branch.replace("dispatch/", "")}{t.ahead ? ` · +${t.ahead}` : ""}{when ? ` · ${ago(when)}` : ""}
                  </div>
                </div>
              </div>
            );
            return (
              <li key={t.branch}>
                {sid ? <button onClick={() => onOpen(sid)} className="w-full text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" title="세션 열기">{card}</button> : card}
              </li>
            );
          })}
        </ul>
      )}

      {g && (g.commits.length
        ? <GraphBody rows={rows} tips={g.tips} sess={sess} onOpen={onOpen} />
        : <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">열린 브랜치가 없어요. 세션이 작업을 시작하면 여기 그려져요.</p>)}
    </div>
  );
}

function Tag({ tip, sess, onOpen }: { tip: BranchTip; sess: SessionMap; onOpen: (id: string) => void }) {
  const who = sess.name.get(tip.branch);
  const sid = sess.id.get(tip.branch);
  const label = tip.base ? tip.branch : tip.branch.replace("dispatch/", "");
  const inner = (
    <span className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
      tip.base ? "bg-primary text-primary-foreground"
        : tip.active ? "border border-ok/40 bg-ok/10 text-ok"
        : "bg-muted text-muted-foreground",
    )}>
      {label}{tip.ahead ? <span className="opacity-70">+{tip.ahead}</span> : null}{who ? <span className="opacity-80">· {who}</span> : null}
    </span>
  );
  return sid
    ? <button onClick={() => onOpen(sid)} title="세션 열기" className="shrink-0 rounded-full hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{inner}</button>
    : inner;
}

function GraphBody({ rows, tips, sess, onOpen }: { rows: ReturnType<typeof layout>["rows"]; tips: BranchTip[]; sess: SessionMap; onOpen: (id: string) => void }) {
  const tipsAt = new Map<string, BranchTip[]>();
  for (const t of tips) { const a = tipsAt.get(t.hash) ?? []; a.push(t); tipsAt.set(t.hash, a); }
  const width = rows.reduce((m, r) => Math.max(m, r.lane + 1), 1);
  const gw = (width + 1) * COL;
  const posOf = new Map(rows.map((r, i) => [r.c.hash, i]));
  return (
    <div className="overflow-auto rounded-xl border bg-card">
      <div className="relative" style={{ height: rows.length * ROW }}>
        <svg className="absolute top-0 left-0" width={gw} height={rows.length * ROW} aria-hidden>
          {rows.map((r, i) =>
            r.parents.map((p, k) => {
              const pi = posOf.get(p);
              if (pi == null) return null;
              const x1 = (r.lane + 1) * COL, y1 = i * ROW + ROW / 2;
              const x2 = (rows[pi].lane + 1) * COL, y2 = pi * ROW + ROW / 2;
              const color = LANE_COLORS[(k === 0 ? r.lane : rows[pi].lane) % LANE_COLORS.length];
              return <path key={`${i}-${k}`} d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`} fill="none" stroke={color} strokeWidth="1.5" opacity="0.75" />;
            }),
          )}
        </svg>
        {rows.map((r, i) => {
          const rowTips = tipsAt.get(r.c.hash) ?? [];
          const color = LANE_COLORS[r.lane % LANE_COLORS.length];
          const onActive = rowTips.some(t => t.active);
          return (
            <div key={r.c.hash} className={cn("absolute flex items-center gap-2.5 pr-3", onActive && "bg-ok/[0.04]")} style={{ top: i * ROW, height: ROW, left: 0, right: 0 }}>
              <span className="grid shrink-0 place-items-center" style={{ width: gw, height: ROW }}>
                <span className="absolute" style={{ left: (r.lane + 1) * COL - 4 }}>
                  {r.c.merge
                    ? <GitMerge className="size-[14px]" style={{ color }} />
                    : <span className="block size-[8px] rounded-full" style={{ background: color, boxShadow: `0 0 0 3px var(--card)` }} />}
                </span>
              </span>
              {rowTips.map(t => <Tag key={t.branch} tip={t} sess={sess} onOpen={onOpen} />)}
              <span className="num shrink-0 text-xs text-muted-foreground">{r.c.short}</span>
              <span className={cn("truncate text-xs", r.c.merge ? "text-muted-foreground" : "text-foreground/85")}>
                {r.c.merge && <CornerDownRight className="mr-1 inline size-3 -translate-y-px opacity-60" />}
                {r.c.subject}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
