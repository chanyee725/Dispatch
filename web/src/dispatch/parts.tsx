// Small shared pieces of the Dispatch screens: state badge, usage meter, model tag.
import { Circle, CircleAlert, CircleCheck, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { cn } from '../lib/utils';
import { ProviderIcon } from '../ProviderIcon';
import { STATE, TONE_TEXT, level, levelTone, providerName, type Tone } from './lib/format.ts';
import type { SessionState } from './types';

/** Provider mark and name, the model label, and the user's account label for that provider when set (#747). */
export function ModelTag({ provider, label, account, className }: { provider: string; label: string; account?: string | null; className?: string }) {
  return (
    <Badge variant="secondary" title={account ? `${label} · 계정 ${account}` : label} className={cn('max-w-full min-w-0 shrink gap-1 rounded-md px-1.5 font-normal', className)}>
      <ProviderIcon provider={provider} className="size-3" />
      <span data-provider={provider} className="shrink-0 font-semibold">{providerName(provider)}</span>
      <span className="truncate text-muted-foreground">{label}</span>
      {account && (
        <span data-account className="max-w-24 shrink truncate border-l border-foreground/15 pl-1 text-muted-foreground">
          <span className="sr-only">계정 </span>
          {account}
        </span>
      )}
    </Badge>
  );
}

// Shape per state, so a badge reads without colour (shape + colour + label).
export const STATE_ICON: Record<SessionState, LucideIcon> = {
  working: LoaderCircle, waiting: CircleAlert, stuck: TriangleAlert, failed: CircleX, resting: Circle, done: CircleCheck,
};

export function StatusBadge({ state, className }: { state: SessionState; className?: string }) {
  const s = STATE[state] ?? STATE.resting;
  const Icon = STATE_ICON[state] ?? Circle;
  return (
    <Badge variant="outline" data-state={state} className={cn('gap-1 pl-1.5 text-foreground/80', className)}>
      <Icon aria-hidden className={cn('size-3.5!', TONE_TEXT[s.tone])} strokeWidth={s.tone === 'warn' || s.tone === 'bad' ? 2.5 : 2} />
      {s.label}
    </Badge>
  );
}

/**
 * Refresh chip (#897): neutral ground with a small dot in the tone colour; the label carries the meaning, so it reads
 * without colour. The 세션 보드 uses it for state and 확인 필요 marks; StatusBadge stays for the other screens.
 */
export function DotChip({ tone, label, state, className }: { tone: Tone | 'none'; label: string; state?: string; className?: string }) {
  return (
    <span data-state={state} className={cn('inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 text-xs font-medium whitespace-nowrap text-foreground/80', className)}>
      <span aria-hidden className={cn('size-[5px] shrink-0 rounded-full bg-current forced-colors:bg-[CanvasText]', TONE_TEXT[tone])} />
      {label}
    </span>
  );
}

/** DotChip for a session state. */
export function StateChip({ state, className }: { state: SessionState; className?: string }) {
  const s = STATE[state] ?? STATE.resting;
  return <DotChip tone={s.tone} label={s.label} state={state} className={className} />;
}

const FILL: Record<Tone | 'none', string> = {
  ok: '[&>[data-slot=progress-indicator]]:bg-ok',
  warn: '[&>[data-slot=progress-indicator]]:bg-warn',
  bad: '[&>[data-slot=progress-indicator]]:bg-destructive',
  idle: '[&>[data-slot=progress-indicator]]:bg-muted-foreground',
  none: '[&>[data-slot=progress-indicator]]:bg-muted-foreground',
};

/**
 * Thin bar (0–1). By default the fill follows the usage-limit ok / warn / failure thresholds; `neutral` is for
 * shares of a whole (cost per role or session), where a full bar is not a warning.
 */
export function Meter({ value, label, className, neutral }: { value: number | null; label: string; className?: string; neutral?: boolean }) {
  const v = Math.min(1, Math.max(0, value ?? 0));
  return (
    <Progress
      value={Math.round(v * 100)}
      aria-label={label}
      data-tone={neutral ? 'neutral' : levelTone(level(value))}
      className={cn('h-1.5 bg-muted', FILL[neutral ? 'none' : levelTone(level(value))], className)}
    />
  );
}
