import { useEffect, useMemo, useState } from "react";
import { ChevronRight, CircleDashed, CornerDownRight, GitBranch, GitMerge } from "lucide-react";
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
  const active = (g?.tips ?? []).filter(t => t.active);
  // Work branches, open work first, then the most recently touched.
  const rowsTips = useMemo(() => (g?.tips ?? []).filter(t => !t.base).sort((x, y) =>
    Number(x.state === "merged") - Number(y.state === "merged") || (y.lastAt ?? 0) - (x.lastAt ?? 0)), [g]);
  const [showGraph, setShowGraph] = useState(() => localStorage.getItem("dispatch-branch-graph") === "1");
  useEffect(() => { localStorage.setItem("dispatch-branch-graph", showGraph ? "1" : "0"); }, [showGraph]);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 p-6 max-md:p-4">
      <header className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold tracking-tight">브랜치</h2>
        <p className="text-sm text-muted-foreground">
          {g ? <>기준 <span className="font-medium text-foreground">{g.base}</span> · 작업 중 {active.length}</> : "불러오는 중…"}
        </p>
      </header>

      {g && (rowsTips.length
        ? <BranchTable tips={rowsTips} base={g.base} laneOf={laneOf} sess={sess} onOpen={onOpen} />
        : <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">열린 브랜치가 없어요. 세션이 작업을 시작하면 여기 보여요.</p>)}

      {g && g.commits.length > 0 && (
        <section className="flex flex-col gap-2">
          <button
            onClick={() => setShowGraph(v => !v)}
            aria-expanded={showGraph}
            className="flex cursor-pointer items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronRight className={cn("size-4 transition-transform", showGraph && "rotate-90")} />
            {showGraph ? "그래프 접기" : "그래프 펼치기"}
            <span className="num text-xs">커밋 {g.commits.length}개</span>
          </button>
          {showGraph && <GraphBody rows={rows} tips={g.tips} sess={sess} onOpen={onOpen} />}
        </section>
      )}
    </div>
  );
}

const STATE_OF = {
  merged: { label: "병합됨", Icon: GitMerge, cls: "text-ok" },
  open: { label: "안 됨", Icon: GitBranch, cls: "text-foreground" },
  empty: { label: "커밋 없음", Icon: CircleDashed, cls: "text-muted-foreground" },
} as const;

/** One line per work branch: "develop 대비 +3 / −12 · 마지막 커밋 8분 전 · 병합됨". */
function BranchTable({ tips, base, laneOf, sess, onOpen }: { tips: BranchTip[]; base: string; laneOf: Map<string, number>; sess: SessionMap; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_7rem] gap-x-4 border-b px-4 py-2 text-xs text-muted-foreground max-md:hidden">
        <span>세션 · 브랜치</span>
        <span>{base} 대비</span>
        <span>마지막 커밋</span>
        <span>병합</span>
      </div>
      <ul className="divide-y">
        {tips.map(t => {
          const who = sess.name.get(t.branch);
          const sid = sess.id.get(t.branch);
          const color = LANE_COLORS[(laneOf.get(t.hash) ?? 0) % LANE_COLORS.length];
          const st = STATE_OF[t.state ?? "open"];
          const name = t.branch.replace("dispatch/", "");
          const line = (
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_7rem] items-center gap-x-4 gap-y-1 px-4 py-2.5 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:px-3">
              <div className="flex min-w-0 items-center gap-2.5 max-md:col-span-2">
                <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{who ?? name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{t.branch}</div>
                </div>
              </div>
              <span className="num text-sm max-md:pl-3.5 max-md:text-xs" title={`${base}에 없는 커밋 ${t.ahead}개 · ${base}에만 있는 커밋 ${t.behind ?? 0}개`}>
                <span className="md:hidden text-muted-foreground">{base} 대비 </span>
                <span className={cn(t.ahead ? "text-foreground" : "text-muted-foreground")}>+{t.ahead}</span>
                <span className="text-muted-foreground"> / −{t.behind ?? 0}</span>
                <span className="md:hidden text-muted-foreground"> · {t.lastAt ? `마지막 커밋 ${ago(t.lastAt)}` : "커밋 없음"}</span>
              </span>
              <span className="num text-sm text-muted-foreground max-md:hidden">{t.lastAt ? ago(t.lastAt) : "—"}</span>
              <span className={cn("flex items-center gap-1.5 text-sm max-md:justify-self-end max-md:text-xs", st.cls)}>
                <st.Icon className="size-3.5 shrink-0" aria-hidden />
                {st.label}
              </span>
            </div>
          );
          return (
            <li key={t.branch}>
              {sid
                ? <button onClick={() => onOpen(sid)} title="세션 열기" className="w-full cursor-pointer text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">{line}</button>
                : line}
            </li>
          );
        })}
      </ul>
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
