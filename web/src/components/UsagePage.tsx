import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Meter, Stat } from "@/components/bits";
import { cn } from "@/lib/utils";
import { fmtK, fmtUsd, pct, roleColor } from "@/lib/format";
import { api, useApp } from "@/store";
import type { Settings, Usage, UsageDay } from "@/types";

const WEEK = 7;

// Sits in the KPI row next to the cache hit rate.
function GuardCard({ settings }: { settings: Settings }) {
  const g = settings.guard;
  const [five, setFive] = useState(Math.round(g.five * 100));
  const [seven, setSeven] = useState(Math.round(g.seven * 100));
  useEffect(() => { setFive(Math.round(g.five * 100)); setSeven(Math.round(g.seven * 100)); }, [g.five, g.seven]);
  const save = (patch: Partial<Settings["guard"]>) =>
    api("POST", "/api/settings", { guard: patch }).then(() => toast.success("자동 차단 설정을 저장했어요"), (e: Error) => toast.error(e.message));
  const clamp = (n: number) => Math.min(100, Math.max(1, n || 0)) / 100;
  const on = g.enabled;
  const field = (label: string, value: number, set: (n: number) => void, key: "five" | "seven") => (
    <label className={cn("flex items-center gap-2 text-sm", on ? "text-primary-foreground/70" : "text-muted-foreground")}>
      <span className="w-10">{label}</span>
      <Input type="number" min={1} max={100} value={value} disabled={!g.enabled} aria-label={`${label} 한도 차단 기준`}
        className={cn("num h-7 w-14 px-2 text-right", on && "border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground hover:border-primary-foreground/50 dark:bg-primary-foreground/5")} onChange={e => set(+e.target.value)} onBlur={() => save({ [key]: clamp(value) })} />
      <span>% 이상</span>
    </label>
  );
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border px-4 py-3.5 transition-colors", on ? "border-transparent bg-primary text-primary-foreground" : "bg-card")}>
      <label className={cn("flex items-center justify-between gap-2 text-[13px]", on ? "text-primary-foreground/80" : "text-muted-foreground")}>
        {on ? "한도 가까우면 막는 중" : "한도 가까우면 막기"}
        <Checkbox checked={g.enabled}
          className={cn(on && "border-primary-foreground/60 hover:border-primary-foreground data-[state=checked]:border-primary-foreground data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary dark:data-[state=checked]:bg-primary-foreground")} onCheckedChange={v => save({ enabled: v === true })} aria-label="한도 가까우면 새 Claude 세션 막기" />
      </label>
      {field("5시간", five, setFive, "five")}
      {field("주간", seven, setSeven, "seven")}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border bg-card p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {note && <span className="num truncate text-sm text-muted-foreground">{note}</span>}
      </header>
      {children}
    </section>
  );
}

export function UsagePage() {
  const settings = useApp(s => s.settings);
  const models = useApp(s => s.models);
  const roles = useApp(s => s.roles);
  const sessions = useApp(s => s.sessions);
  const [days, setDays] = useState<UsageDay[]>([]);
  const [projects, setProjects] = useState<ProjectUsage[]>([]);

  useEffect(() => {
    api<{ days: UsageDay[] }>("GET", "/api/usage").then(r => setDays(r.days), (e: Error) => toast.error(e.message));
    api<{ projects: ProjectUsage[] }>("GET", "/api/usage/all").then(r => setProjects(r.projects), () => {});
  }, [sessions]);

  const week = days.slice(-WEEK);
  const agg = useMemo(() => {
    const byModel: Record<string, Usage & { cost: number }> = {};
    const byRole: Record<string, number> = {};
    for (const d of week) {
      for (const [m, u] of Object.entries(d.models)) {
        const t = (byModel[m] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
        t.input += u.input; t.output += u.output; t.cacheRead += u.cacheRead; t.cacheWrite += u.cacheWrite; t.cost += u.cost;
      }
      for (const [r, c] of Object.entries(d.roles)) byRole[r] = (byRole[r] ?? 0) + c;
    }
    return { byModel, byRole };
  }, [days]);

  const sum = (ds: UsageDay[]) => ds.reduce((a, d) => a + d.cost, 0);
  const weekCost = sum(week), prevCost = sum(days.slice(0, -WEEK)), all = sum(days);
  const cache = Object.values(agg.byModel).reduce((a, u) => ({ r: a.r + u.cacheRead, t: a.t + u.cacheRead + u.cacheWrite + u.input }), { r: 0, t: 0 });
  const roleTotal = Object.values(agg.byRole).reduce((a, b) => a + b, 0) || 1;
  const label = (id: string) => models.find(m => m.id === id)?.label ?? id;
  const isCodex = (id: string) => models.find(m => m.id === id)?.provider === "openai";
  const modelRows = Object.entries(agg.byModel).sort((a, b) => b[1].cost - a[1].cost || b[1].output - a[1].output);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-6 max-md:p-4">
      <div className="grid grid-cols-5 gap-3 max-xl:grid-cols-3 max-sm:grid-cols-1">
        <Stat label="오늘" value={fmtUsd(days.at(-1)?.cost ?? 0)} hint="Claude API 환산" />
        <Stat label="최근 7일" value={fmtUsd(weekCost)} hint={prevCost ? `그 전 7일보다 ${weekCost >= prevCost ? "+" : ""}${Math.round((weekCost / prevCost - 1) * 100)}%` : "비교할 이전 기록 없음"} />
        <Stat label="최근 14일" value={fmtUsd(all)} hint={`하루 평균 ${fmtUsd(all / 14)}`} />
        <Stat label="캐시 적중률" value={cache.t ? pct(cache.r / cache.t) : "—"} hint="최근 7일 입력 중 캐시에서 읽은 비율" />
        <GuardCard settings={settings} />
      </div>

      <div className="grid grid-cols-3 gap-3 max-xl:grid-cols-2 max-lg:grid-cols-1">
        <DailyByProject projects={projects} fallback={week} />

        <Panel title="모델별 사용량" note="최근 7일">
          {modelRows.length ? (
            <table className="w-full table-fixed text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="w-[44%] pb-2 text-left font-normal">모델</th>
                  <th className="pb-2 text-right font-normal">입력</th>
                  <th className="pb-2 text-right font-normal">출력</th>
                  <th className="pb-2 text-right font-normal">비용</th>
                </tr>
              </thead>
              <tbody className="num">
                {modelRows.map(([m, u]) => (
                  <tr key={m} className="border-b last:border-0">
                    <td className="truncate py-2.5 pr-2" title={label(m)}>{label(m)}</td>
                    <td className="py-2.5 text-right">
                      <Tooltip>
                        <TooltipTrigger className="cursor-default">{fmtK(u.input + u.cacheRead + u.cacheWrite)}</TooltipTrigger>
                        <TooltipContent>새 입력 {fmtK(u.input)}, 캐시 {fmtK(u.cacheRead + u.cacheWrite)}</TooltipContent>
                      </Tooltip>
                    </td>
                    <td className="py-2.5 text-right">{fmtK(u.output)}</td>
                    <td className="py-2.5 text-right">{isCodex(m) ? "—" : fmtUsd(u.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">최근 7일 기록이 없어요</p>
          )}
        </Panel>

        <Panel title="역할별 비용" note="최근 7일">
          <ul className="flex flex-col gap-3.5">
            {roles.map(r => (
              <li key={r.id} className="grid grid-cols-[64px_1fr_64px] items-center gap-3 text-sm">
                <span>{r.name}</span>
                <Meter value={(agg.byRole[r.id] ?? 0) / roleTotal} color={roleColor(r.id)} />
                <span className="num text-right text-muted-foreground">{fmtUsd(agg.byRole[r.id] ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <ProjectsPanel projects={projects} />
    </div>
  );
}

type ProjectUsage = { port: number; name: string; path: string; current: boolean; days: UsageDay[]; error?: boolean };

function ProjectsPanel({ projects }: { projects: ProjectUsage[] }) {
  const rows = projects
    .map(p => {
      const week = p.days.slice(-WEEK);
      const tok = (ds: UsageDay[]) =>
        ds.reduce((a, d) => a + Object.values(d.models).reduce((b, u) => b + u.input + u.output + u.cacheRead + u.cacheWrite, 0), 0);
      return {
        ...p,
        today: p.days.at(-1)?.cost ?? 0,
        week: week.reduce((a, d) => a + d.cost, 0),
        all: p.days.reduce((a, d) => a + d.cost, 0),
        tokens: tok(week),
      };
    })
    .sort((a, b) => b.week - a.week);
  const total = rows.reduce((a, r) => ({ today: a.today + r.today, week: a.week + r.week, all: a.all + r.all, tokens: a.tokens + r.tokens }), { today: 0, week: 0, all: 0, tokens: 0 });
  return (
    <Panel title="프로젝트별 사용량" note="이 PC에서 실행 중인 Dispatch 전체">
      {rows.length ? (
        <table className="w-full table-fixed text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="w-[38%] pb-2 text-left font-normal">프로젝트</th>
              <th className="pb-2 text-right font-normal">오늘</th>
              <th className="pb-2 text-right font-normal">최근 7일</th>
              <th className="pb-2 text-right font-normal">7일 토큰</th>
              <th className="pb-2 text-right font-normal">최근 14일</th>
            </tr>
          </thead>
          <tbody className="num">
            {rows.map(r => (
              <tr key={r.port} className="border-b last:border-0">
                <td className="py-2.5 pr-2">
                  <div className="truncate font-medium">{r.name}{r.current ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(지금)</span> : null}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.path} · :{r.port}{r.error ? " · 불러오지 못함" : ""}</div>
                </td>
                <td className="py-2.5 text-right">{fmtUsd(r.today)}</td>
                <td className="py-2.5 text-right">{fmtUsd(r.week)}</td>
                <td className="py-2.5 text-right">{fmtK(r.tokens)}</td>
                <td className="py-2.5 text-right">{fmtUsd(r.all)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="num font-semibold">
            <tr>
              <td className="pt-2.5">합계</td>
              <td className="pt-2.5 text-right">{fmtUsd(total.today)}</td>
              <td className="pt-2.5 text-right">{fmtUsd(total.week)}</td>
              <td className="pt-2.5 text-right">{fmtK(total.tokens)}</td>
              <td className="pt-2.5 text-right">{fmtUsd(total.all)}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중이에요…</p>
      )}
    </Panel>
  );
}

// One colour per project, in the order the projects are listed (stable while they run).
const PROJECT_COLORS = ["var(--role-impl)", "var(--role-review)", "var(--role-lead)", "var(--role-test)", "var(--role-design)", "var(--role-docs)"];

/** Daily cost for the last 7 days, one stacked segment per project, so the bar height is the total. */
function DailyByProject({ projects, fallback }: { projects: ProjectUsage[]; fallback: UsageDay[] }) {
  const list = projects.length ? [...projects].sort((a, b) => a.port - b.port) : [];
  const color = (i: number) => PROJECT_COLORS[i % PROJECT_COLORS.length];
  const days = (list.length ? list[0].days : fallback).slice(-WEEK).map(d => d.day);
  const cols = days.map(day => {
    const parts = list.length
      ? list.map((p, i) => ({ name: p.name, color: color(i), cost: p.days.find(d => d.day === day)?.cost ?? 0 }))
      : [{ name: "이 프로젝트", color: color(0), cost: fallback.find(d => d.day === day)?.cost ?? 0 }];
    return { day, parts, total: parts.reduce((a, p) => a + p.cost, 0) };
  });
  const max = Math.max(...cols.map(c => c.total), 0.0001);
  const weekTotal = cols.reduce((a, c) => a + c.total, 0);
  return (
    <Panel title="일별 비용" note={`최근 7일 ${fmtUsd(weekTotal)} · 모든 프로젝트`}>
      <div className="flex h-44 items-end gap-2">
        {cols.map(c => (
          <Tooltip key={c.day}>
            <TooltipTrigger asChild>
              <div className="group flex h-full flex-1 flex-col items-center justify-end" tabIndex={0} aria-label={`${c.day} 합계 ${fmtUsd(c.total)}`}>
                <div className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-md transition-[filter] group-hover:brightness-125 group-focus-visible:brightness-125"
                  style={{ height: `${Math.max((c.total / max) * 100, 1.5)}%` }}>
                  {c.parts.map(p => (
                    <div key={p.name} style={{ height: c.total ? `${(p.cost / c.total) * 100}%` : "100%", background: c.total ? p.color : "var(--border)" }} />
                  ))}
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <div className="num flex flex-col gap-0.5">
                <span className="font-medium">{c.day} 합계 {fmtUsd(c.total)}</span>
                {c.parts.filter(p => p.cost > 0).map(p => (
                  <span key={p.name} className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ background: p.color }} />
                    {p.name} {fmtUsd(p.cost)}
                  </span>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="mt-2 flex gap-2 border-t pt-2 text-xs text-muted-foreground">
        {cols.map((c, i) => <span key={c.day} className="num flex-1 text-center">{i === cols.length - 1 ? "오늘" : c.day.slice(5).replace("-", "/")}</span>)}
      </div>
      {list.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {list.map((p, i) => (
            <li key={p.port} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: color(i) }} />
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
