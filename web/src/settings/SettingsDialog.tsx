// The one 설정 modal (#624): a narrow section list on the left (a <select> on top below 768px) and the chosen
// section on the right. A native modal <dialog> gives the inert page, focus containment, Esc and focus return. While
// it is open it holds the session stream open, so every section reads the same store (#625); the sections stay
// mounted and only the chosen one shows, so unsaved edits survive switching. The chosen section id is remembered in
// this browser. Closing it with unsaved input asks first (#638): the sections report it through markDirty, the modal
// then takes closedby="none" and Esc, the X button and any other close request open a small confirm dialog instead.
// Loaded lazily from SettingsEntry and the /dispatch screen.
import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { connect, setState, useDispatch } from '../dispatch/store';
import { cn } from '../lib/utils';
import { SectionShownContext, SettingsContext } from './context';
import { useDispatchStatus } from './DispatchOff';
import { BTN, PRIMARY_BTN } from './LimitsForm';
import { SECTION_KEY, SECTIONS, firstSection, settingsLoad, stopEscWhileOpen, type SectionId } from './model';
import { SECTION_COMPONENTS } from './slots';
import './limits.css';

const remembered = () => {
  try {
    return localStorage.getItem(SECTION_KEY);
  } catch {
    return null;
  }
};

export default function SettingsDialog({ section, onClose }: { section?: SectionId; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const selectId = useId();
  const [current, setCurrent] = useState<SectionId>(() => firstSection(section, remembered()));
  const pick = (id: SectionId) => {
    setCurrent(id);
    try {
      localStorage.setItem(SECTION_KEY, id);
    } catch {
      /* storage off: the choice lasts until the modal closes */
    }
  };

  // Hold the session stream open while the modal is; 다시 시도 clears the failed mark and connects again.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => connect(), [attempt]);
  const status = useDispatchStatus();
  const ready = useDispatch((s) => s.ready);
  const unavailable = useDispatch((s) => s.unavailable);
  // The parts holding unsaved input (#638), by key; only whether, never the values.
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(() => new Set());
  const markDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((prev) => {
      if (prev.has(key) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const dirty = dirtyKeys.size > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const confirmRef = useRef<HTMLDialogElement>(null);
  const confirmTitleId = useId();
  const confirmTextId = useId();
  // Close at once when nothing is unsaved; otherwise ask in the confirm dialog (its safe button has focus).
  const askClose = useCallback(() => {
    const c = confirmRef.current;
    if (!dirtyRef.current) return ref.current?.close();
    if (c && !c.open) c.showModal();
  }, []);

  const ctx = useMemo(
    () => ({
      load: settingsLoad(status, ready, unavailable),
      retry: () => {
        setState({ unavailable: false });
        setAttempt((a) => a + 1);
      },
      markDirty,
    }),
    [status, ready, unavailable, markDirty],
  );

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.showModal();
      // Start on the chosen section's nav item (the <select> below 768px, where the list is hidden).
      const item = navRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
      (item && item.offsetParent ? item : d.querySelector<HTMLElement>(`#${CSS.escape(selectId)}`))?.focus();
    }
    // Below 768px the sidebar is a Radix Sheet that listens for Esc on document (capture), so one Esc would close
    // the Sheet too and unmount the 설정 row focus returns to (#552). Stop the key at window, before document; the
    // dialog's own close request still runs, since it is the key's default action, not a listener.
    const stop = stopEscWhileOpen(window, () => !!ref.current?.open);
    // With unsaved input, Esc asks instead of closing. closedby="none" already keeps Chrome and Firefox from closing;
    // preventing the key also covers browsers without closedby. Esc inside the open confirm closes only the confirm.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || !ref.current?.open || confirmRef.current?.open || !dirtyRef.current) return;
      e.preventDefault();
      askClose();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      stop();
      window.removeEventListener('keydown', onKey, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid="settings-dialog"
      {...({ closedby: dirty ? 'none' : 'closerequest' } as object)}
      // Any other close request (the back gesture, a browser without closedby) asks first too.
      onCancel={(e) => {
        if (e.target !== ref.current || !dirtyRef.current) return;
        e.preventDefault();
        askClose();
      }}
      onClose={(e) => {
        if (e.target === ref.current) onClose();
      }}
      // The refresh (#889): a card with panel corners and the ink ring, the section list on the panel step at left.
      className="settings-dialog m-auto h-[min(680px,calc(100dvh-2rem))] w-[min(960px,calc(100vw-1rem))] max-w-none overflow-hidden rounded-panel border-0 bg-card p-0 text-card-foreground shadow-[0_0_0_1px_var(--border),0_24px_60px_rgb(0_0_0/0.22)] max-md:h-[calc(100dvh-1rem)]"
    >
      <SettingsContext.Provider value={ctx}>
        <div className="relative flex h-full min-h-0 max-md:flex-col">
          <aside className="flex w-[220px] shrink-0 flex-col bg-background px-2 py-4 max-md:w-full max-md:gap-2 max-md:border-b max-md:px-(--overlay-x) max-md:py-3">
            <h2 id={titleId} className="px-2 pb-3 text-base font-semibold max-md:p-0 max-md:pr-10">
              설정
            </h2>
            <nav ref={navRef} aria-label="설정 항목" className="min-h-0 overflow-y-auto max-md:hidden">
              <ul className="flex flex-col gap-px">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      data-section={s.id}
                      aria-current={current === s.id ? 'true' : undefined}
                      onClick={() => pick(s.id)}
                      className={cn(
                        'press flex h-8 w-full items-center rounded-control px-2 text-left text-sm text-muted-foreground outline-none hover:bg-(--sunken) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                        // The current item sits on the card step, like the app's other nav (no side bar, #675). Not by
                        // colour alone: it is also bold (WCAG 1.4.1).
                        'aria-[current=true]:bg-card aria-[current=true]:font-semibold aria-[current=true]:text-foreground aria-[current=true]:shadow-(--shadow-card)',
                      )}
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="hidden max-md:block">
              <label htmlFor={selectId} className="sr-only">
                설정 항목
              </label>
              <select
                id={selectId}
                data-testid="settings-section-select"
                value={current}
                onChange={(e) => pick(e.target.value as SectionId)}
                className="h-11 w-full rounded-control border border-(--line-strong) bg-card px-2 text-sm"
              >
                {SECTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </aside>
          {/* Closing sits at the top right of the section, level with its title (the title leaves room for it). */}
          <button type="button" aria-label="설정 닫기" onClick={askClose} className={cn(BTN, 'absolute top-4 right-4 z-10 size-8 px-0 text-muted-foreground max-md:size-11 max-md:top-2.5')}>
            <X aria-hidden className="mx-auto size-4" />
          </button>
          <div className="flex min-h-0 min-w-0 flex-1">
            <div className="settings-dialog-body min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-5 pb-6 max-md:px-(--overlay-x)">
              {SECTIONS.map((s) => {
                const Section = SECTION_COMPONENTS[s.id];
                return (
                  <div key={s.id} data-settings-section={s.id} hidden={current !== s.id}>
                    <SectionShownContext.Provider value={current === s.id}>
                      <Section />
                    </SectionShownContext.Provider>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </SettingsContext.Provider>
      <dialog
        ref={confirmRef}
        aria-labelledby={confirmTitleId}
        aria-describedby={confirmTextId}
        data-testid="settings-close-confirm"
        className="settings-confirm m-auto w-[min(360px,calc(100vw-2rem))] max-w-none overlay-box rounded-panel border-0 bg-card text-card-foreground shadow-[0_0_0_1px_var(--border),0_24px_60px_rgb(0_0_0/0.22)]"
      >
        <h2 id={confirmTitleId} className="text-sm font-semibold">
          저장하지 않은 내용이 있어요
        </h2>
        <p id={confirmTextId} className="mt-1 text-sm text-muted-foreground">
          지금 닫으면 입력한 내용이 사라져요.
        </p>
        <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => (confirmRef.current?.close(), ref.current?.close())} className={cn(BTN, 'border text-destructive')}>
            닫기
          </button>
          <button
            // React's autoFocus only focuses on mount, it is not the HTML attribute showModal reads; set the attribute
            // so the confirm opens on the safe button, never on 닫기.
            ref={(el) => el?.setAttribute('autofocus', '')}
            type="submit"
            className={PRIMARY_BTN}
          >
            계속 수정하기
          </button>
        </form>
      </dialog>
    </dialog>
  );
}
