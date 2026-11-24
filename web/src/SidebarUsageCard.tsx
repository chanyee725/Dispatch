// Usage card for a sidebar model row (E548, #698): hovering or keyboard-focusing a provider row shows that provider's
// usage limits. Claude: 5시간, 주간, Fable 주간; OpenAI Codex: the windows its CLI reports; Gemini: the windows agy's
// /usage reports (#878), else whether its quota was hit. Each window shows the percent used, when it resets and the block threshold from 설정 > 사용 한도 (#676).
// Data comes from useUsage (the same /api/limits + providers read as the home dashboard), and the thresholds from
// GET /api/state settings plus the `settings` event, both read only while the card is open. Numbers only: no account,
// email or token is read or kept.
//
// The card is supplemental (the row's click opens 모델 연결, where the same numbers live), so it is a tooltip:
// role="tooltip", described by the row while open, never focused, closed by Esc, by leaving the row and the card,
// and by blur (WCAG 1.4.13: dismissible, hoverable, persistent). It sits in the top layer (popover="manual") beside
// the row, placed from the row's box so it never covers it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { api, type DispatchSettings } from './api';
import { Meter } from './dispatch/parts';
import { pct, until } from './dispatch/lib/format.ts';
import { useUsage } from './lib/usage';
import { events } from './lib/events';
import { lastValue } from './lib/lastValue';
import type { ProviderMeta } from './modelConnect';
import { cardRows, type CardRow } from './lib/usageCardRows';
import type { UsageGroup } from './settings/model';

/** Hover delays, like the default interest delay but shorter: open after a short rest, close after a grace period. */
const OPEN_MS = 250;
const CLOSE_MS = 150;
const GAP = 8;

const keptSettings = lastValue<DispatchSettings>();
const settingsOf = () => {
  const s = keptSettings.get();
  return s === 'failed' ? null : s;
};

/** Saved guard settings, read while the card is open and followed through the `settings` event; the card starts from
 *  the last read (#705) so the thresholds do not pop in on every hover. */
function useGuardSettings(): DispatchSettings | null {
  const [settings, setSettings] = useState<DispatchSettings | null>(settingsOf);
  useEffect(() => {
    let live = true;
    const keep = (s: DispatchSettings) => {
      keptSettings.put(s);
      if (live) setSettings(s);
    };
    api.dispatchState().then(
      (s) => s.settings && keep(s.settings),
      () => {},
    );
    const off = events.subscribeJson<DispatchSettings>('settings', (s) => s?.guard && keep(s));
    return () => {
      live = false;
      off();
    };
  }, []);
  return settings;
}

/**
 * Open state for a row's card. Pointer hover (mouse or pen, not touch) opens it after OPEN_MS; keyboard focus
 * (:focus-visible) opens it at once. Leaving both the row and the card, blur, Esc or a click closes it.
 */
export function useUsageCard() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const later = (next: boolean, ms: number) => {
    clear();
    timer.current = setTimeout(() => setOpen(next), ms);
  };
  const close = useCallback(() => {
    clear();
    setOpen(false);
  }, []);
  useEffect(() => clear, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);
  const hover = {
    onPointerEnter: (e: React.PointerEvent) => e.pointerType !== 'touch' && later(true, open ? 0 : OPEN_MS),
    onPointerLeave: (e: React.PointerEvent) => e.pointerType !== 'touch' && later(false, CLOSE_MS),
  };
  const trigger = {
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(':focus-visible')) {
        clear();
        setOpen(true);
      }
    },
    onBlur: close,
  };
  return { open, close, hover, trigger };
}

/** Where the card goes: to the right of the row, else below it; kept inside the viewport and never over the row. */
function place(row: DOMRect, card: { width: number; height: number }, vw: number, vh: number) {
  const fitsRight = row.right + GAP + card.width <= vw - GAP;
  if (fitsRight) return { left: row.right + GAP, top: Math.max(GAP, Math.min(row.top, vh - card.height - GAP)) };
  const below = row.bottom + GAP + card.height <= vh - GAP;
  return { left: Math.max(GAP, Math.min(row.left, vw - card.width - GAP)), top: below ? row.bottom + GAP : Math.max(GAP, row.top - GAP - card.height) };
}

/**
 * The card for one provider row. It is rendered inside the row's SidebarMenuItem (the top layer moves it on screen,
 * not in the DOM), so the item's pointer handlers already cover hovering the card; it has none of its own (#705).
 */
export function SidebarUsageCard({ id, meta, anchor, statusText }: { id: string; meta: ProviderMeta; anchor: RefObject<HTMLElement | null>; statusText: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const usage = useUsage();
  const settings = useGuardSettings();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Top layer where the Popover API exists, so the sidebar's overflow and the shell's stacking never clip it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== 'function') return;
    try {
      el.showPopover();
    } catch {
      /* already open */
    }
    return () => {
      try {
        el.hidePopover();
      } catch {
        /* already closed */
      }
    };
  }, []);

  // Placed from the row's box, again whenever the content (and so the height) changes, the window resizes, or the
  // sidebar (or any other scroller, caught in the capture phase) scrolls the row (#705).
  useLayoutEffect(() => {
    const measure = () => {
      const row = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (row && el) setPos(place(row, { width: el.offsetWidth, height: el.offsetHeight }, window.innerWidth, window.innerHeight));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, { capture: true });
    };
  }, [anchor, usage, settings]);

  const group = Array.isArray(usage) ? usage.find((g) => g.id === id) : undefined;
  const rows = cardRows(id, group, settings);
  return (
    <div
      ref={ref}
      id={`usage-card-${id}`}
      popover="manual"
      role="tooltip"
      data-testid="usage-card"
      data-provider={id}
      style={{ position: 'fixed', inset: 'auto', margin: 0, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className="z-50 popover-box w-64 rounded-md border bg-popover text-popover-foreground shadow-md"
    >
      <p className="mb-2 flex items-baseline gap-2 text-sm font-medium">
        {meta.name}
        {group?.plan && <span className="text-xs font-normal text-muted-foreground">{group.plan}</span>}
      </p>
      <CardBody usage={usage} group={group} rows={rows} name={meta.name} statusText={statusText} />
    </div>
  );
}

function CardBody({ usage, group, rows, name, statusText }: { usage: ReturnType<typeof useUsage>; group: UsageGroup | undefined; rows: CardRow[]; name: string; statusText: string }) {
  const note = 'text-xs text-muted-foreground';
  if (usage === null) return <p className={note}>불러오는 중이에요…</p>;
  if (usage === 'failed') return <p className={note}>사용량을 불러오지 못했어요.</p>;
  if (!group) return <p className={note}>{statusText}. 연결하면 사용량이 보여요.</p>;
  if (rows.length === 0) {
    if (group.reached != null)
      return <p className={note}>{group.reached ? `한도에 닿았어요.${group.reset ? ` ${until(group.reset)} 뒤 풀려요.` : ''}` : '한도에 닿지 않았어요.'}</p>;
    return <p className={note}>아직 사용량 정보가 없어요.</p>;
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-sm">
          <span>{r.label}</span>
          <span className="tabular-nums">{pct(r.used)}</span>
          <Meter value={r.used} label={`${name} ${r.label} ${pct(r.used)}`} className="col-span-2" />
          <span className={`col-span-2 ${note}`}>
            {[r.used == null ? '아직 정보가 없어요' : r.reset ? `${until(r.reset)} 뒤 풀려요` : null, r.limit != null ? `${r.limit}%에서 멈춰요` : null].filter(Boolean).join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  );
}
