// The sidebar's theme switch, ported from Dispatch: a segmented radio group with one icon per theme. Roving focus
// (Tab lands on the chosen one; arrows, Home and End pick another) follows the WAI-ARIA radio group pattern. Hover only
// brightens the icon, as in Dispatch (a hover fill would look like the raised, chosen item); forced colours mark the
// chosen one with Highlight. The chosen item is raised in every theme: white on a grey track in light, a lighter tint in
// dark and 모니터링 (--card there is darker than the track, which made it look pressed in, #684).
import { useRef, type KeyboardEvent } from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { FOCUS_RING } from './lib/focus';
import { cn } from './lib/utils';
import type { Theme, ThemePref } from './theme';

export const THEME_CHOICES: { id: ThemePref; label: string; icon: LucideIcon }[] = [
  { id: 'system', label: '시스템', icon: Monitor },
  { id: 'light', label: '라이트', icon: Sun },
  { id: 'dark', label: '다크', icon: Moon },
];

const NEXT: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** `labelledBy`: name the group by a visible heading instead of 테마 (the 설정 dialog and page, #620). */
export function ThemeSwitch({ pref, onPref, system, labelledBy, className }: { pref: ThemePref; onPref: (t: ThemePref) => void; system: Theme; labelledBy?: string; className?: string }) {
  const group = useRef<HTMLDivElement>(null);
  const pick = (i: number) => {
    const n = THEME_CHOICES.length;
    const t = THEME_CHOICES[((i % n) + n) % n];
    onPref(t.id);
    group.current?.querySelector<HTMLElement>(`[data-theme-id="${t.id}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const at = THEME_CHOICES.findIndex((t) => t.id === pref);
    if (e.key in NEXT) pick(at + NEXT[e.key]);
    else if (e.key === 'Home') pick(0);
    else if (e.key === 'End') pick(THEME_CHOICES.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={labelledBy ? undefined : '테마'}
      aria-labelledby={labelledBy}
      data-testid="theme-switch"
      onKeyDown={onKey}
      className={cn('mb-0.5 flex gap-0.5 rounded-lg bg-foreground/6 p-0.5', className)}
    >
      {THEME_CHOICES.map(({ id, label, icon: Icon }) => {
        const on = pref === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={id === 'system' ? `${label} (지금 ${system === 'dark' ? '다크' : '라이트'})` : label}
            tabIndex={on ? 0 : -1}
            data-theme-id={id}
            onClick={() => onPref(id)}
            className={cn(
              'flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md transition-colors max-md:h-11',
              on
                ? 'bg-card text-foreground shadow-sm dark:bg-foreground/14 dark:shadow-none forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:forced-color-adjust-none'
                : 'text-muted-foreground hover:text-foreground',
              FOCUS_RING,
            )}
          >
            <Icon aria-hidden className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
