// 사용량 screen (E29): usage limits, cost and token numbers for this project, from the metadata the server keeps
// (GET /api/usage: 14 days of daily cost, token counts per model and cost per role and session). Read-only: the
// limit guard is changed in 설정.
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { roleColor } from './lib/roles';
import { burnWarnText, fmtK, fmtRate, fmtUsd, pct, totalTok, until } from './lib/format.ts';
import {
  WEEK, aggregate, burnNow, cacheRate, createUsageRefetcher, outliers, projectUsageFail, projectUsageOk, projectUsageShown, topSessions, totals,
  usageKey, weekHint, type ProjectUsage,
} from './lib/usage.ts';
import { Meter } from './parts';
import { api, useDispatch } from './store';
import { useScope, useScoped } from './scope';
import { UNFILED } from './lib/folder.ts';
import type { UsageDay } from './types';
import type { Session } from '../../../shared/dispatch/types.ts';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
      {hint && <span className="truncate text-xs text-muted-foreground" title={hint}>{hint}</span>}
    </div>
  );
}

function Panel({ title, note, children, className }: { title: string; note?: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('flex min-w-0 flex-col rounded-lg border bg-card p-4', className)}>
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
        {note && <span className="truncate text-sm text-muted-foreground tabular-nums">{note}</span>}
      </header>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;

/** Claude 5-hour / weekly / Fable limits from the CLI's own rate-limit events, with the reset countdown. */
function LimitsPanel() {
  const limits = useDispatch(s => s.limits);
  const guard = useDispatch(s => s.settings.guard);
  const rows = [
    { label: '5시간', value: limits.five, reset: limits.fiveReset },
    { label: '주간', value: limits.seven, reset: limits.sevenReset },
    { label: 'Fable', value: limits.fable ?? null, reset: limits.fableReset ?? null },
  ].filter(r => r.value != null);
  return (
    <Panel title="한도 · 계정 전체" note={guard.enabled ? `5시간 ${pct(guard.five)} · 주간 ${pct(guard.seven)}부터 새 작업을 막아요` : '자동 차단이 꺼져 있어요'}>
      {rows.length ? (
        <ul className="flex flex-col gap-3">
          {rows.map(r => (
            <li key={r.label} data-limit={r.label} className="grid grid-cols-[56px_1fr_48px] items-center gap-3 text-sm">
              <span>{r.label}</span>
              <Meter value={r.value} label={`${r.label} 한도 ${pct(r.value)}`} />
              <span className="text-right tabular-nums">{pct(r.value)}</span>
              {r.reset && <span className="col-start-2 col-end-4 -mt-2 text-xs text-muted-foreground">{until(r.reset)} 뒤 초기화</span>}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>아직 한도 정보가 없어요. Claude 세션이 돌면 채워져요.</Empty>
      )}
    </Panel>
  );
}

/** Daily cost for the last 7 days; a day at twice the usual (median) cost or more gets a warning mark and "n배". */
function DailyPanel({ days }: { days: UsageDay[] }) {
  const { scope } = useScope();
  const week = days.slice(-WEEK);
  const { median, ratio } = outliers(week.map(d => d.cost));
  const max = Math.max(...week.map(d => d.cost), 0.0001);
  const total = week.reduce((a, d) => a + d.cost, 0);
  return (
    <Panel title="일별 비용" note={`${scope === undefined ? '' : '계정 전체 · '}최근 7일 ${fmtUsd(total)}`}>
      <ol className="flex h-40 items-end gap-2 pt-5" aria-label="최근 7일 일별 비용">
        {week.map((d, i) => {
          const r = ratio[i];
          const h = Math.max((d.cost / max) * 100, 1.5);
          const top = Object.values(d.sessions ?? {}).sort((a, b) => b.cost - a.cost).slice(0, 3);
          const text = `${d.day} ${fmtUsd(d.cost)}${r != null && median != null ? `, 평소(${fmtUsd(median)})의 ${r}배` : ''}${top.length ? `. 많이 쓴 세션: ${top.map(s => `${s.name} ${fmtUsd(s.cost)}`).join(', ')}` : ''}`;
          return (
            <li key={d.day} data-day={d.day} title={text} aria-label={text} className="relative flex h-full flex-1 flex-col items-center justify-end">
              {r != null && (
                <span className="absolute flex items-center gap-0.5 text-2xs font-semibold whitespace-nowrap tabular-nums" style={{ bottom: `calc(${h}% + 4px)` }}>
                  <TriangleAlert aria-hidden className="size-3 text-warn" strokeWidth={2.5} />
                  {r}배
                </span>
              )}
              <span className={cn('block w-full max-w-10 rounded-t-sm', d.cost ? 'bg-foreground/70' : 'bg-border', r != null && 'bg-warn')} style={{ height: `${h}%` }} />
            </li>
          );
        })}
      </ol>
      <div aria-hidden className="mt-2 flex gap-2 border-t pt-2 text-xs text-muted-foreground tabular-nums">
        {week.map((d, i) => (
          <span key={d.day} className={cn('flex-1 text-center', ratio[i] != null && 'font-semibold text-foreground')}>
            {i === week.length - 1 ? '오늘' : d.day.slice(5).replace('-', '/')}
          </span>
        ))}
      </div>
    </Panel>
  );
}

const th = 'pb-2 font-normal';

type FolderUsage = { sessions: number; cost: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } };

/** Cost and tokens of the picked project's sessions (GET /api/usage?folder=; 미분류 is summed from the sessions in view). */
function ProjectPanel({ name, folder, sessions }: { name: string; folder: string | null; sessions: Session[] }) {
  const [got, setGot] = useState<ProjectUsage<FolderUsage>>(null);
  // A failed load has no session event to wait for (it may never come), so the person can ask again.
  const [retry, setRetry] = useState(0);
  const key = usageKey(sessions);
  useEffect(() => {
    if (folder === null) return;
    const ctl = new AbortController();
    api<FolderUsage>('GET', `/api/usage?folder=${encodeURIComponent(folder)}`, undefined, ctl.signal)
      .then(d => setGot(projectUsageOk(folder, d)), () => { if (!ctl.signal.aborted) setGot(s => projectUsageFail(s, folder)); });
    return () => ctl.abort();
  }, [folder, key, retry]);
  const local: FolderUsage = {
    sessions: sessions.length,
    cost: sessions.reduce((a, s) => a + (s.cost ?? 0), 0),
    tokens: sessions.reduce((a, s) => ({ input: a.input + s.usage.input, output: a.output + s.usage.output, cacheRead: a.cacheRead + s.usage.cacheRead, cacheWrite: a.cacheWrite + s.usage.cacheWrite }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
  };
  const shown = folder === null ? { data: local, stale: false, failed: false } : projectUsageShown(got, folder);
  const u = shown.data;
  const again = <Button size="sm" variant="outline" onClick={() => setRetry(n => n + 1)}>다시 불러오기</Button>;
  return (
    <Panel title={`${name} 사용량`} note="이 프로젝트의 세션만">
      {u ? (
        <>
          <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
            <Stat label="세션" value={`${u.sessions}개`} />
            <Stat label="비용" value={fmtUsd(u.cost)} hint="Claude API 요금으로 환산" />
            <Stat label="토큰" value={fmtK(totalTok(u.tokens))} />
          </div>
          {shown.stale && (
            <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
              <p>새 숫자를 불러오지 못해서 지난 숫자예요.</p>
              {again}
            </div>
          )}
        </>
      ) : shown.failed ? (
        <div className="flex items-center justify-center gap-3 py-6 text-sm text-muted-foreground">
          <p>프로젝트 사용량을 불러오지 못했어요.</p>
          {again}
        </div>
      ) : <Empty>불러오는 중이에요…</Empty>}
    </Panel>
  );
}

export function UsagePage() {
  const models = useDispatch(s => s.models);
  const roles = useDispatch(s => s.roles);
  const all = useDispatch(s => s.sessions);
  const { scope, names } = useScope();
  const { sessions: scoped } = useScoped();
  const sessions = all; // the daily chart, roles and models are account-wide; only the project panel and the top list follow the scope
  const [days, setDays] = useState<UsageDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Refetch only when the sessions' cost or token totals move (a finished turn adds to today), not on every session
  // event; the refetcher spaces the requests out, also while a failed first load keeps retrying, never drops a
  // request that is already out, and gives up on one that does not answer within REFETCH_TIMEOUT_MS.
  const key = usageKey(sessions);
  const [refetcher] = useState(() => createUsageRefetcher(
    signal => api<{ days: UsageDay[] }>('GET', '/api/usage', undefined, signal).then(r => r.days),
    { result: d => { setDays(d); setError(null); }, error: setError, loading: setLoading },
  ));
  useEffect(() => { refetcher.start(); return () => refetcher.stop(); }, [refetcher]);
  useEffect(() => { refetcher.change(); }, [refetcher, key]);
  // A failed first load tries again on the next session event (spaced out) or with the button below.
  const firstLoadFailed = error !== null && days === null;
  useEffect(() => { if (firstLoadFailed) refetcher.change(); }, [refetcher, sessions]);

  const list = days ?? [];
  const agg = useMemo(() => aggregate((days ?? []).slice(-WEEK)), [days]);
  const t = totals(list);
  const burn = burnNow(sessions);
  const cache = cacheRate(agg.byModel);
  const roleTotal = Object.values(agg.byRole).reduce((a, b) => a + b, 0) || 1;
  const label = (id: string) => models.find(m => m.id === id)?.label ?? id;
  const modelRows = Object.entries(agg.byModel).sort((a, b) => b[1].cost - a[1].cost || b[1].output - a[1].output);
  const top = topSessions(scoped);
  const sessionTotal = scoped.reduce((a, s) => a + (s.cost ?? 0), 0) || 1;

  if (firstLoadFailed) return (
    <div role="alert" className="flex items-center gap-3 p-6 text-sm text-destructive">
      <p>사용량을 불러오지 못했어요: {error}</p>
      <Button size="sm" variant="outline" aria-disabled={loading || undefined} onClick={() => refetcher.reload()}>다시 불러오기</Button>
    </div>
  );
  if (!days) return <p className="p-6 text-sm text-muted-foreground">불러오는 중이에요…</p>;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] shrink-0 grow flex-col gap-4 p-6 max-md:p-4">
      {scope !== undefined && <ProjectPanel name={scope === null ? UNFILED : names.get(scope) ?? scope} folder={scope} sessions={scoped} />}
      <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <Stat label={scope === undefined ? '오늘' : '오늘 · 계정 전체'} value={fmtUsd(t.today)} hint="Claude API 요금으로 환산" />
        <Stat label={scope === undefined ? '최근 7일' : '최근 7일 · 계정 전체'} value={fmtUsd(t.week)} hint={`${weekHint(t.week, t.prev, fmtUsd)} · 14일 ${fmtUsd(t.all)}`} />
        <Stat label={scope === undefined ? '지금 시간당' : '지금 시간당 · 계정 전체'} value={burn.rated ? fmtRate(burn.perHour) : '—'}
          hint={burn.rated ? `최근 30분 · 세션 ${burn.rated}개 합계` : sessions.some(s => s.burn) ? '시작하고 5분 뒤부터 보여요' : '비용을 알리는 세션이 없어요'} />
        <Stat label={scope === undefined ? '캐시 적중률' : '캐시 적중률 · 계정 전체'} value={pct(cache)} hint="최근 7일 입력 중 캐시에서 읽은 비율" />
      </div>

      <div className="grid grid-cols-3 gap-3 max-xl:grid-cols-2 max-lg:grid-cols-1">
        <LimitsPanel />
        <DailyPanel days={list} />
        <Panel title="역할별 비용" note={scope === undefined ? '최근 7일' : '최근 7일 · 계정 전체'}>
          {roles.length ? (
            <ul className="flex flex-col gap-3">
              {roles.map(r => (
                <li key={r.id} className="grid grid-cols-[64px_1fr_64px] items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full" style={{ background: roleColor(r.id) }} />{r.name}</span>
                  <Meter neutral value={(agg.byRole[r.id] ?? 0) / roleTotal} label={`${r.name} 비용 비율`} />
                  <span className="text-right text-muted-foreground tabular-nums">{fmtUsd(agg.byRole[r.id] ?? 0)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>역할 정보가 없어요</Empty>}
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        <Panel title="모델별 사용량" note={scope === undefined ? '최근 7일' : '최근 7일 · 계정 전체'}>
          {modelRows.length ? (
            <table className="w-full table-fixed text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className={cn(th, 'w-[40%] text-left')}>모델</th>
                  <th scope="col" className={cn(th, 'text-right')}>입력</th>
                  <th scope="col" className={cn(th, 'text-right')}>출력</th>
                  <th scope="col" className={cn(th, 'text-right')}>비용</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {modelRows.map(([m, u]) => (
                  <tr key={m} className="border-b last:border-0">
                    <th scope="row" className="truncate py-2 pr-2 text-left font-normal" title={label(m)}>{label(m)}</th>
                    <td className="py-2 text-right" title={`새 입력 ${fmtK(u.input)}, 캐시 ${fmtK(u.cacheRead + u.cacheWrite)}`}>{fmtK(u.input + u.cacheRead + u.cacheWrite)}</td>
                    <td className="py-2 text-right">{fmtK(u.output)}</td>
                    <td className="py-2 text-right">{fmtUsd(u.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>최근 7일 기록이 없어요</Empty>}
        </Panel>

        <Panel title="세션별 비용 상위 10" note="시간당은 최근 30분 기준">
          {top.length ? (
            <table className="w-full table-fixed text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className={cn(th, 'w-[50%] text-left')}>세션</th>
                  <th scope="col" className={cn(th, 'text-left max-sm:hidden')}>모델</th>
                  <th scope="col" className={cn(th, 'text-right')}>누적</th>
                  <th scope="col" className={cn(th, 'text-right')}>시간당</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {top.map(s => {
                  const warn = s.burnWarn ? burnWarnText(s.burnWarn) : null;
                  return (
                    <tr key={s.id} data-session={s.name} className="border-b align-top last:border-0">
                      <th scope="row" className="py-2 pr-2 text-left font-normal">
                        <span className="flex items-center gap-1.5 truncate">
                          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: roleColor(s.role) }} />
                          <span className="truncate font-medium">{s.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{s.roleName}</span>
                        </span>
                        {warn && (
                          <span className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warn" strokeWidth={2.5} />
                            <span>{[...warn.reasons, warn.advice].filter(Boolean).join('. ')}</span>
                          </span>
                        )}
                        <Meter neutral className="mt-1.5 h-1" value={(s.cost ?? 0) / sessionTotal} label={`${s.name} 비용 비율`} />
                      </th>
                      <td className="truncate py-2 pr-2 text-muted-foreground max-sm:hidden" title={s.modelLabel}>{s.modelLabel}</td>
                      <td className="py-2 text-right">{fmtUsd(s.cost)}</td>
                      <td className="py-2 text-right">
                        {s.burn?.perHour == null ? <span className="text-muted-foreground">{s.burn ? '재는 중' : '—'}</span> : fmtRate(s.burn.perHour)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <Empty>비용을 알리는 세션이 없어요.</Empty>}
        </Panel>
      </div>
    </div>
  );
}
