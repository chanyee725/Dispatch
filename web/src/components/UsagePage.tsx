import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Meter, Stat } from "@/components/bits";
import { LEVEL_COLOR, ago, fmtK, fmtUsd, level, pct, roleColor, until } from "@/lib/format";
import { api, useApp } from "@/store";
import type { Settings, Usage, UsageDay } from "@/types";

const LEVEL_LABEL = { ok: "여유", warn: "주의", bad: "위험", none: "정보 없음" };

function LimitCard({ title, value, reset, updatedAt }: { title: string; value: number | null; reset: number | null; updatedAt: number | null }) {
  const lv = level(value);
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{title}</span>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
          <span className="size-1.5 rounded-full" style={{ background: LEVEL_COLOR[lv] }} />
          {LEVEL_LABEL[lv]}
        </span>
      </div>
      <div className="num text-4xl font-semibold tracking-tight">{pct(value)}</div>
      <Meter value={value} className="h-2" />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{reset ? `초기화까지 ${until(reset)}` : "Claude 세션을 한 번 실행하면 표시돼요"}</span>
        {updatedAt && <span>{ago(updatedAt)} 기준</span>}
      </div>
    </div>
  );
}

function Guard({ settings }: { settings: Settings }) {
  const g = settings.guard;
  const [five, setFive] = useState(Math.round(g.five * 100));
  const [seven, setSeven] = useState(Math.round(g.seven * 100));
  useEffect(() => { setFive(Math.round(g.five * 100)); setSeven(Math.round(g.seven * 100)); }, [g.five, g.seven]);
  const save = (patch: Partial<Settings["guard"]>) =>
    api("POST", "/api/settings", { guard: patch }).then(() => toast.success("자동 차단 설정을 저장했어요"), (e: Error) => toast.error(e.message));
  const clamp = (n: number) => Math.min(100, Math.max(1, n || 0)) / 100;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card px-5 py-3.5 text-sm">
      <label className="flex items-center gap-2.5 font-medium">
        <Checkbox checked={g.enabled} onCheckedChange={v => save({ enabled: v === true })} />
        한도 가까우면 새 Claude 세션 막기
      </label>
      <label className="flex items-center gap-2 text-muted-foreground">
        5시간
        <Input type="number" min={1} max={100} value={five} disabled={!g.enabled} className="num h-8 w-16 text-right"
          onChange={e => setFive(+e.target.value)} onBlur={() => save({ five: clamp(five) })} />
        % 이상
      </label>
      <label className="flex items-center gap-2 text-muted-foreground">
        주간
        <Input type="number" min={1} max={100} value={seven} disabled={!g.enabled} className="num h-8 w-16 text-right"
          onChange={e => setSeven(+e.target.value)} onBlur={() => save({ seven: clamp(seven) })} />
        % 이상
      </label>
    </div>
  );
}

export function UsagePage() {
  const limits = useApp(s => s.limits);
  const settings = useApp(s => s.settings);
  const models = useApp(s => s.models);
  const roles = useApp(s => s.roles);
  const sessions = useApp(s => s.sessions);
  const [days, setDays] = useState<UsageDay[]>([]);

  useEffect(() => {
    api<{ days: UsageDay[] }>("GET", "/api/usage").then(r => setDays(r.days), (e: Error) => toast.error(e.message));
  }, [sessions]);

  const agg = useMemo(() => {
    const byModel: Record<string, Usage & { cost: number }> = {};
    const byRole: Record<string, number> = {};
    for (const d of days) {
      for (const [m, u] of Object.entries(d.models)) {
        const t = (byModel[m] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
        t.input += u.input; t.output += u.output; t.cacheRead += u.cacheRead; t.cacheWrite += u.cacheWrite; t.cost += u.cost;
      }
      for (const [r, c] of Object.entries(d.roles)) byRole[r] = (byRole[r] ?? 0) + c;
    }
    return { byModel, byRole };
  }, [days]);

  const sum = (ds: UsageDay[]) => ds.reduce((a, d) => a + d.cost, 0);
  const week = sum(days.slice(7)), prev = sum(days.slice(0, 7)), all = sum(days);
  const cache = Object.values(agg.byModel).reduce((a, u) => ({ r: a.r + u.cacheRead, t: a.t + u.cacheRead + u.cacheWrite + u.input }), { r: 0, t: 0 });
  const max = Math.max(...days.map(d => d.cost), 0.0001);
  const roleTotal = Object.values(agg.byRole).reduce((a, b) => a + b, 0) || 1;
  const label = (id: string) => models.find(m => m.id === id)?.label ?? id;
  const isCodex = (id: string) => models.find(m => m.id === id)?.provider === "openai";

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-6 max-md:p-4">
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <LimitCard title="5시간 한도" value={limits.five} reset={limits.fiveReset} updatedAt={limits.updatedAt} />
        <LimitCard title="주간 한도" value={limits.seven} reset={limits.sevenReset} updatedAt={limits.updatedAt} />
      </div>
      <Guard settings={settings} />

      <div className="mt-2 grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <Stat label="오늘" value={fmtUsd(days.at(-1)?.cost ?? 0)} hint="Claude API 환산" />
        <Stat label="최근 7일" value={fmtUsd(week)} hint={prev ? `이전 7일보다 ${week >= prev ? "+" : ""}${Math.round((week / prev - 1) * 100)}%` : "비교할 이전 기록 없음"} />
        <Stat label="최근 14일" value={fmtUsd(all)} hint={`하루 평균 ${fmtUsd(all / 14)}`} />
        <Stat label="캐시 적중률" value={cache.t ? pct(cache.r / cache.t) : "—"} hint="입력 중 캐시에서 읽은 비율" />
      </div>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 text-[15px] font-semibold">일별 비용</h2>
        <div className="flex h-40 items-end gap-1.5">
          {days.map((d, i) => (
            <Tooltip key={d.day}>
              <TooltipTrigger asChild>
                <div className="flex h-full flex-1 items-end" tabIndex={0} aria-label={`${d.day} ${fmtUsd(d.cost)}`}>
                  <div className="w-full rounded-t-md transition-[height]"
                    style={{ height: `${Math.max(d.cost / max * 100, 1.5)}%`, background: i === days.length - 1 ? "var(--role-impl)" : "color-mix(in oklch, var(--role-impl) 45%, transparent)" }} />
                </div>
              </TooltipTrigger>
              <TooltipContent>{d.day} {fmtUsd(d.cost)}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5 border-t pt-2 text-[11px] text-muted-foreground">
          {days.map((d, i) => <span key={d.day} className="num flex-1 text-center">{i === days.length - 1 ? "오늘" : d.day.slice(5).replace("-", "/")}</span>)}
        </div>
      </section>

      <div className="grid grid-cols-[1.4fr_1fr] gap-3 max-lg:grid-cols-1">
        <section className="overflow-x-auto rounded-xl border bg-card">
          <h2 className="px-5 pt-4 pb-2 text-[15px] font-semibold">모델별 사용량 <span className="text-sm font-normal text-muted-foreground">최근 14일</span></h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-5 py-2 text-left font-normal">모델</th>
                <th className="px-3 py-2 text-right font-normal">입력</th>
                <th className="px-3 py-2 text-right font-normal">캐시</th>
                <th className="px-3 py-2 text-right font-normal">출력</th>
                <th className="px-5 py-2 text-right font-normal">비용</th>
              </tr>
            </thead>
            <tbody className="num">
              {Object.entries(agg.byModel).sort((a, b) => b[1].cost - a[1].cost).map(([m, u]) => (
                <tr key={m} className="border-b last:border-0">
                  <td className="px-5 py-2.5">{label(m)}</td>
                  <td className="px-3 py-2.5 text-right">{fmtK(u.input)}</td>
                  <td className="px-3 py-2.5 text-right">{fmtK(u.cacheRead + u.cacheWrite)}</td>
                  <td className="px-3 py-2.5 text-right">{fmtK(u.output)}</td>
                  <td className="px-5 py-2.5 text-right">{isCodex(m) ? "—" : fmtUsd(u.cost)}</td>
                </tr>
              ))}
              {Object.keys(agg.byModel).length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">아직 기록이 없어요</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 text-[15px] font-semibold">역할별 비용 <span className="text-sm font-normal text-muted-foreground">최근 14일</span></h2>
          <ul className="flex flex-col gap-3">
            {roles.map(r => (
              <li key={r.id} className="grid grid-cols-[64px_1fr_64px] items-center gap-3 text-sm">
                <span>{r.name}</span>
                <Meter value={(agg.byRole[r.id] ?? 0) / roleTotal} color={roleColor(r.id)} />
                <span className="num text-right text-muted-foreground">{fmtUsd(agg.byRole[r.id] ?? 0)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
