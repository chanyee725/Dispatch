// 사용 한도 section of the 설정 modal (#624): each connected provider's usage (GET /api/limits, read by provider id,
// never assumed to be Claude's) and the shared guard form (LimitsForm: a group per connected provider, #676, and
// the session-length guards). The guards keep their defaults unless changed and cannot be switched off here.
// Numbers only: no account, email or token is read.
import { useEffect, useId, useState } from 'react';
import { Meter } from '../../dispatch/parts';
import { pct, until } from '../../dispatch/lib/format.ts';
import { api, useDispatch } from '../../dispatch/store';
import { cn } from '../../lib/utils';
import { OffNote } from '../DispatchOff';
import { BTN, LimitsForm } from '../LimitsForm';
import { useSectionShown, useSettingsLoad } from '../context';
import { usageGroups, type SettingsLoad, type UsageEntry } from '../model';
import { SectionFrame } from '../SectionFrame';

/** Per-provider usage windows, fetched once the section is shown, then again when the server pushes new limits or providers change. */
function ProviderUsage({ load }: { load: SettingsLoad }) {
  const headingId = useId();
  const providers = useDispatch((s) => s.providers);
  const pushed = useDispatch((s) => s.limits);
  const [limits, setLimits] = useState<Record<string, UsageEntry> | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const ok = load.kind === 'ok';
  // Hidden behind another section, it asks for nothing (#639).
  const shown = useSectionShown();
  useEffect(() => {
    if (!ok || !shown) return;
    let alive = true;
    api<Record<string, UsageEntry>>('GET', '/api/limits').then(
      (l) => alive && (setLimits(l), setFailed(false)),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [ok, shown, pushed, providers, tick]);
  const groups = limits ? usageGroups(limits, providers) : [];
  return (
    <div role="group" aria-labelledby={headingId} data-testid="settings-usage" className="flex flex-col gap-3">
      <h4 id={headingId} className="text-sm font-medium">
        모델별 사용량
      </h4>
      {load.kind === 'off' && <OffNote status={load.status} />}
      {ok && failed && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          사용량을 불러오지 못했어요.
          <button type="button" onClick={() => setTick((t) => t + 1)} className={cn(BTN, 'bg-card shadow-(--shadow-card)')}>
            다시 불러오기
          </button>
        </p>
      )}
      {ok && !failed && !limits && <p className="text-sm text-muted-foreground">불러오는 중이에요…</p>}
      {ok && limits && groups.length === 0 && <p className="text-sm text-muted-foreground">연결된 모델이 없어요.</p>}
      {ok &&
        groups.map((g) => (
          // One panel card per provider, like 모델 연결 (#889).
          <div key={g.id} data-provider={g.id} className="flex flex-col gap-2.5 rounded-card bg-background px-4 py-3.5">
            <h5 className="text-sm font-medium">
              {g.name}
              {g.plan && <span className="ml-2 rounded-full bg-(--sunken) px-2 text-2xs font-normal text-muted-foreground">{g.plan}</span>}
            </h5>
            {g.windows.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {g.windows.map((w) => (
                  <li key={w.label} className="grid grid-cols-[88px_1fr_48px] items-center gap-3 text-sm">
                    <span className="text-muted-foreground">{w.label}</span>
                    {/* The ink line as the track: --muted sits too close to the panel step in dark mode. */}
                    <Meter value={w.used} label={`${g.name} ${w.label} ${pct(w.used)}`} className="bg-(color:--line-strong)" />
                    <span className="text-right tabular-nums">{pct(w.used)}</span>
                    {w.reset ? <span className="col-start-2 col-end-4 -mt-2 text-xs text-muted-foreground">{until(w.reset)} 뒤 초기화</span> : null}
                  </li>
                ))}
              </ul>
            ) : g.reached != null ? (
              <p className="text-sm text-muted-foreground">
                {g.reached ? `한도에 닿았어요.${g.reset ? ` ${until(g.reset)} 뒤 풀려요.` : ''}` : '한도에 닿지 않았어요.'}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">아직 사용량 정보가 없어요. 세션이 돌면 채워져요.</p>
            )}
          </div>
        ))}
    </div>
  );
}

export default function UsageLimitsSection() {
  const { load, retry } = useSettingsLoad();
  return (
    <SectionFrame title="사용 한도" hint="연결한 모델마다 한도에 가까워지면 그 모델의 새 작업을 멈추고, 세션이 길어지면 새 세션으로 넘겨요." testId="settings-section-limits">
      <ProviderUsage load={load} />
      <LimitsForm load={load} onRetry={retry} />
    </SectionFrame>
  );
}
