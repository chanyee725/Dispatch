// Settings with Dispatch off (#620): the 설정 modal and page still render. What does not need sessions (the theme)
// works; session sections (team, role models, usage, limits) show read-only, each with one line saying why and what
// to do (offReason). Status only: GET /api/dispatch carries a reason code and a message, nothing else.
import { useEffect, useId, useState } from 'react';
import { api, type DispatchStatus } from '../api';
import { cn } from '../lib/utils';
import { useTheme } from '../theme';
import { ThemeSwitch } from '../ThemeSwitch';
import { offReason, type SettingsLoad } from './model';

/** GET /api/dispatch once; null while loading. A failed request reads as off with no reason. */
export function useDispatchStatus(): DispatchStatus | null {
  const [status, setStatus] = useState<DispatchStatus | null>(null);
  useEffect(() => {
    let alive = true;
    api.dispatch().then(
      (s) => alive && setStatus(s),
      () => alive && setStatus({ enabled: false }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

/** The one-line reason under a disabled session section. `id` lets the section point aria-describedby at it. */
export function OffNote({ id, status, className }: { id?: string; status: DispatchStatus | null; className?: string }) {
  return (
    <p id={id} data-testid="settings-off-note" className={cn('rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground', className)}>
      {status ? offReason(status) : '불러오는 중이에요…'}
    </p>
  );
}

/**
 * While session settings load, or after the stream's state request failed: one line, and a retry when it failed
 * (#624, #625). A failure is not Dispatch being off, so it says so and offers 다시 시도.
 */
export function LoadNote({ load, onRetry, className }: { load: SettingsLoad; onRetry: () => void; className?: string }) {
  if (load.kind !== 'loading' && load.kind !== 'failed') return null;
  const failed = load.kind === 'failed';
  return (
    <div data-testid="settings-load-note" className={cn('flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground', className)}>
      <p role={failed ? 'alert' : 'status'}>{failed ? '세션 설정을 불러오지 못했어요.' : '불러오는 중이에요…'}</p>
      {failed && (
        <button type="button" onClick={onRetry} className="h-7 rounded-md border px-2 text-xs text-foreground hover:bg-accent max-md:h-11">
          다시 시도
        </button>
      )}
    </div>
  );
}

/** 화면 테마: the same four choices as the sidebar switch, named by its visible heading. Works with Dispatch off. */
export function ThemeField({ headingClass = 'text-sm font-medium' }: { headingClass?: string }) {
  const [, , pref, setPref, system] = useTheme();
  const id = useId();
  return (
    <div data-testid="settings-theme" className="flex flex-col gap-2">
      <h4 id={id} className={headingClass}>
        화면 테마
      </h4>
      <ThemeSwitch pref={pref} onPref={setPref} system={system} labelledBy={id} className="mx-0 mb-0 max-w-64" />
    </div>
  );
}
