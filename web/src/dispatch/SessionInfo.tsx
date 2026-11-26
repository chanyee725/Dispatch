import { cn } from '../lib/utils';
import { fmtK, fmtUsd, pct, permLabel, totalTok } from './lib/format.ts';
import { PROMPT_CLEARED, shownPrompt } from './lib/rolePrompt.ts';
import { useDispatch } from './store';
import type { Session } from './types';

export function Info({ s }: { s: Session }) {
  const roles = useDispatch(st => st.roles);
  const prompt = shownPrompt(s, roles);
  // Same plain sections as the 진행 tab (2026-11-20): no grey boxes, a hairline between sections, a bold heading each.
  const rows: [string, string][] = [
    ['모델', `${s.modelLabel || s.model}${s.effort ? ` · effort ${s.effort}` : ''}`],
    ['역할', `${s.roleName}${s.canSpawn ? ' · 팀원을 만들 수 있어요' : ''}`],
    ['권한 모드', permLabel(s.perm)],
    ['세션 ID', s.id],
    ['CLI 세션', s.providerSessionId ?? '—'],
  ];
  const ctx = s.ctx;
  const ratio = ctx != null && s.ctxWindow > 0 ? ctx / s.ctxWindow : null;
  const usage: [string, number][] = [['입력', s.usage.input], ['출력', s.usage.output], ['캐시 읽기', s.usage.cacheRead], ['캐시 쓰기', s.usage.cacheWrite]];
  const section = 'border-t border-border/70 py-4 first:border-t-0 first:pt-1';
  const heading = 'm-0 mb-2.5 text-xs font-semibold text-foreground';
  return (
    <div className="flex h-full flex-col overflow-y-auto overlay-body font-sans text-xs leading-[1.55]">
      <section aria-label="세션" className={section}>
        <h3 className={heading}>세션</h3>
        <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="m-0 min-w-0 break-all text-foreground tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="컨텍스트" className={section}>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="m-0 text-xs font-semibold text-foreground">컨텍스트</h3>
          <span className="tabular-nums text-muted-foreground">
            {ratio == null || ctx == null ? '미확인' : <><span className="font-semibold text-foreground">{pct(ratio)}</span> · {fmtK(ctx)} / {fmtK(s.ctxWindow)}</>}
          </span>
        </div>
        {ratio != null && (
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className={cn('h-full rounded-full', ratio >= 0.85 ? 'bg-bad' : ratio >= 0.6 ? 'bg-warn' : 'bg-ok')} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
          </div>
        )}
      </section>

      <section aria-label="토큰과 비용" className={section}>
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <h3 className="m-0 text-xs font-semibold text-foreground">
            누적 처리 토큰 <span className="tabular-nums">{fmtK(totalTok(s.usage))}</span>
          </h3>
          <span className="text-muted-foreground">
            비용 <span className="text-base font-semibold tracking-[-0.01em] text-foreground tabular-nums">{fmtUsd(s.cost)}</span>
          </span>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {usage.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="m-0 text-base font-semibold tracking-[-0.01em] tabular-nums">{fmtK(v)}</dd>
            </div>
          ))}
        </dl>
        {s.cost == null && <p className="m-0 mt-2 text-xs text-muted-foreground">이 CLI는 비용을 알려주지 않아요.</p>}
      </section>

      <details className={cn(section, 'group')}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-semibold marker:hidden">
          역할 프롬프트
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">펼치기</span>
          <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">접기</span>
          {/* Visible while folded too: says why the role default shows instead of the session's own task (#943). */}
          {prompt.fallback && <span data-prompt-cleared className="order-last basis-full text-xs font-normal text-muted-foreground">{PROMPT_CLEARED}</span>}
        </summary>
        {prompt.text && (
          <p className="m-0 mt-2.5 max-h-72 overflow-y-auto whitespace-pre-wrap text-muted-foreground" data-prompt-fallback={prompt.fallback || undefined}>
            {prompt.fallback && <span className="mb-1 block text-xs font-medium text-foreground/80">{s.roleName} 기본 프롬프트</span>}
            {prompt.text}
          </p>
        )}
      </details>
    </div>
  );
}
