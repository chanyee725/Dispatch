// 설정 row in the sidebar (#624): opens the one 설정 modal, loaded on first open so the editor bundle does not carry it.
import { Settings } from 'lucide-react';
import { lazy, Suspense, useRef, useState, type RefObject } from 'react';
import { SidebarMenuButton } from '../components/ui/sidebar';
import type { SectionId } from './model';

const SettingsDialog = lazy(() => import('./SettingsDialog'));

/** The 설정 modal, loaded on first use; `section` picks where it opens. */
export function SettingsModal({ section, onClose }: { section?: SectionId; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <SettingsDialog section={section} onClose={onClose} />
    </Suspense>
  );
}

/** Closes the modal and puts focus back on its opener when the browser left it on <body>. */
export const closeTo = (trigger: RefObject<HTMLElement | null>, close: () => void) => () => {
  close();
  requestAnimationFrame(() => {
    if (!document.activeElement || document.activeElement === document.body) trigger.current?.focus();
  });
};

export function SettingsEntry() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <SidebarMenuButton ref={trigger} data-testid="settings-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Settings aria-hidden />
        <span className="truncate">설정</span>
      </SidebarMenuButton>
      {open && <SettingsModal onClose={closeTo(trigger, () => setOpen(false))} />}
    </>
  );
}
