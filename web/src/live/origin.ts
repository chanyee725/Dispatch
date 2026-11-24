// Where a right-side panel came from (#942). The card or row that opened a panel (live view, team panel) wears
// `data-origin` and gets aria-current="true" while its panel is open (ring + darker fill in index.css). The panel's
// head shows the path back (대시보드 › 실행 중인 세션 › Bea). On close, focus goes back to the trigger, the card is
// scrolled into view when off screen, and it flashes once (a 600ms ring that fades) so it is clear what was pressed.

/** How long the return flash lasts; matches `origin-flash` in index.css. */
export const FLASH_MS = 600;

/** The dashboard's section names, used as the middle crumb. */
export const TRAIL = {
  sessions: ['대시보드', '실행 중인 세션'],
  issues: ['대시보드', '진행 중인 이슈'],
  board: ['세션 보드'],
} as const;

/** The live view's crumbs when opened from a team panel row: the team panel's own path plus the issue. */
export const teamTrail = (issue: number): string[] => [...TRAIL.issues, `#${issue}`];

/** The element to mark: the card or row around the trigger (`data-origin`), else the trigger itself. */
export function originOf(trigger: HTMLElement): HTMLElement {
  return (trigger.closest('[data-origin]') as HTMLElement | null) ?? trigger;
}

/** True when the box is not fully inside the viewport. */
export function offscreen(r: { top: number; bottom: number }, viewH: number): boolean {
  return r.top < 0 || r.bottom > viewH;
}

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const flashes = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * Focus back on `trigger` after its panel closed: scroll its card into view when it is off screen, then flash the
 * card once. Restarts the flash when it is already running (two quick closes).
 */
export function returnToOrigin(trigger: HTMLElement | null): void {
  if (!trigger?.isConnected) return;
  const card = originOf(trigger);
  trigger.focus({ preventScroll: true });
  if (typeof window !== 'undefined' && offscreen(card.getBoundingClientRect(), window.innerHeight)) {
    card.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  }
  const prev = flashes.get(card);
  if (prev) clearTimeout(prev);
  card.removeAttribute('data-origin-flash');
  void card.offsetWidth; // restart the animation
  card.setAttribute('data-origin-flash', '');
  flashes.set(card, setTimeout(() => {
    card.removeAttribute('data-origin-flash');
    flashes.delete(card);
  }, FLASH_MS + 50));
}
