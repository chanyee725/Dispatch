// shadcn/ui (MIT) new-york Sidebar, adapted and trimmed for the app shell (design doc 6 §2.1, §3.1):
// relative imports, no desktop collapse (the sidebar is always shown from 768px; below that it is a Sheet drawer),
// SidebarInset has two frames: `floating` (inset panel on the frame, layout B) and `attached` (flush, 1px left line,
// layout A, used by the document screen). Sizes follow doc 6 §4.2: 264px wide, 30px rows, 44px rows in the drawer.
// From 768px the width is the person's own (#934): SidebarResizeHandle on the right edge sets --sidebar-width, 200–480px.
import * as React from 'react';
import { Slot as SlotPrimitive } from 'radix-ui';
import { cn } from '../../lib/utils';
import { FOCUS_RING } from '../../lib/focus';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet';
import { keyWidth, useSidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from '../../lib/sidebarWidth';

/** The drawer below 768px keeps the design width; only the desktop column is resizable. */
const DRAWER_WIDTH = `${SIDEBAR_DEFAULT}px`;
const MOBILE_QUERY = '(max-width: 767px)';

// Sidebar colours. The shell and sidebar sit on --sidebar; the inset panel stays on --background.
// Hover is a 5% tint of --sidebar-foreground; the current row is lifted onto --card with the card ring (#889), so it
// reads as a raised paper step in every theme, apart from a hovered one (#684), and still shows in 모니터링 where
// --card and --sidebar match. A row action hovered inside a hovered row stacks the tint and still shows.
// Forced colours outline the current row, since there the fill is gone.
const C = {
  bg: 'bg-sidebar text-sidebar-foreground',
  hover: 'cursor-pointer transition-colors hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground',
  active:
    'aria-[current=page]:bg-card aria-[current=page]:font-medium aria-[current=page]:shadow-card aria-[current=page]:text-sidebar-foreground forced-colors:aria-[current=page]:outline-1 forced-colors:aria-[current=page]:outline-[Highlight]',
  border: 'border-sidebar-border',
};

type SidebarContextValue = {
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  toggleSidebar: () => void;
  width: number;
  previewWidth: (w: number) => void;
  commitWidth: (w: number) => void;
};
const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within a SidebarProvider.');
  return ctx;
}

export function useIsMobile() {
  const [mobile, setMobile] = React.useState(() => window.matchMedia(MOBILE_QUERY).matches);
  React.useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

/** `openMobile` / `onOpenMobileChange` make the drawer controlled (the app closes it after opening a file). */
function SidebarProvider({
  className,
  style,
  children,
  openMobile: openProp,
  onOpenMobileChange,
  ...props
}: React.ComponentProps<'div'> & { openMobile?: boolean; onOpenMobileChange?: (open: boolean) => void }) {
  const isMobile = useIsMobile();
  const [openState, setOpenState] = React.useState(false);
  const openMobile = openProp ?? openState;
  const setOpenMobile = React.useCallback((o: boolean) => (onOpenMobileChange ? onOpenMobileChange(o) : setOpenState(o)), [onOpenMobileChange]);
  const toggleSidebar = React.useCallback(() => setOpenMobile(!openMobile), [setOpenMobile, openMobile]);
  const { width, preview: previewWidth, commit: commitWidth } = useSidebarWidth();
  const value = React.useMemo(
    () => ({ isMobile, openMobile, setOpenMobile, toggleSidebar, width, previewWidth, commitWidth }),
    [isMobile, openMobile, setOpenMobile, toggleSidebar, width, previewWidth, commitWidth],
  );
  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        style={{ '--sidebar-width': `${width}px`, ...style } as React.CSSProperties}
        className={cn('flex h-full w-full', C.bg, className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

/** Desktop: a column on the frame. Mobile: a left drawer with its own (screen-reader) title. */
function Sidebar({ className, children, label, ...props }: React.ComponentProps<'nav'> & { label: string }) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const nav = (
    <nav data-slot="sidebar" aria-label={label} className={cn('relative flex h-full w-(--sidebar-width) shrink-0 flex-col', C.bg, className)} {...props}>
      {children}
      {!isMobile && <SidebarResizeHandle />}
    </nav>
  );
  if (!isMobile) return nav;
  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      {/* The sheet is portalled out of the wrapper, so it sets the width variable itself. */}
      <SheetContent
        side="left"
        style={{ '--sidebar-width': DRAWER_WIDTH } as React.CSSProperties}
        className={cn('w-[min(var(--sidebar-width),85vw)] p-0', C.bg, C.border)}
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">{label}</SheetTitle>
        <SheetDescription className="sr-only">보기, 프로젝트, 모델 연결</SheetDescription>
        {nav}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The sidebar's right edge (#934): drag, ←/→ (Shift for bigger steps) or Home to resize, double-click for the default.
 * A WAI-ARIA window splitter: a focusable separator with its value. Quiet until hovered, focused or dragged,
 * then a 1px line in the ring colour; the 8px hit area straddles the edge.
 */
function SidebarResizeHandle() {
  const { width, previewWidth, commitWidth } = useSidebar();
  const drag = React.useRef<{ x: number; from: number; to: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    commitWidth(d.to);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="사이드바 너비"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      aria-valuetext={`${width}px`}
      tabIndex={0}
      title="드래그하거나 ←/→로 너비를 바꿔요. 더블클릭하면 처음 너비로 돌아가요."
      data-slot="sidebar-resize"
      data-dragging={dragging ? '' : undefined}
      className="group/resize absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none select-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // no text selection while dragging
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, from: width, to: width };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.to = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, d.from + e.clientX - d.x));
        previewWidth(d.to);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => commitWidth(SIDEBAR_DEFAULT)}
      onKeyDown={(e) => {
        const next = keyWidth(width, e.key, e.shiftKey);
        if (next === null) return;
        e.preventDefault();
        commitWidth(next);
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover/resize:bg-foreground/20 group-focus-visible/resize:w-0.5 group-focus-visible/resize:bg-ring group-data-dragging/resize:bg-ring motion-reduce:transition-none forced-colors:group-focus-visible/resize:bg-[Highlight]"
      />
    </div>
  );
}

/** The main panel next to the sidebar. */
function SidebarInset({ className, frame = 'floating', ...props }: React.ComponentProps<'main'> & { frame?: 'floating' | 'attached' }) {
  return (
    <div data-slot="sidebar-inset-wrap" className={cn('flex min-w-0 flex-1', frame === 'floating' && 'md:py-2 md:pr-2')}>
      <main
        data-slot="sidebar-inset"
        data-frame={frame}
        className={cn(
          'flex min-w-0 flex-1 flex-col overflow-hidden bg-background',
          frame === 'floating' ? 'md:rounded-panel md:shadow-card' : cn('md:border-l', C.border),
          className,
        )}
        {...props}
      />
    </div>
  );
}

const SidebarHeader = ({ className, ...props }: React.ComponentProps<'div'>) => <div data-slot="sidebar-header" className={cn('flex flex-col gap-0.5 p-2', className)} {...props} />;
const SidebarContent = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div data-slot="sidebar-content" className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-2', className)} {...props} />
);
const SidebarFooter = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div data-slot="sidebar-footer" className={cn('mx-2 mb-2 flex flex-col gap-0.5 pt-2', className)} {...props} />
);
const SidebarGroup = ({ className, ...props }: React.ComponentProps<'div'>) => <div data-slot="sidebar-group" className={cn('relative flex flex-col', className)} {...props} />;
const SidebarGroupLabel = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div data-slot="sidebar-group-label" className={cn('flex h-[30px] items-center px-2 text-xs font-medium text-muted-foreground', className)} {...props} />
);
function SidebarGroupAction({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      data-slot="sidebar-group-action"
      className={cn('absolute top-0.5 right-1 flex size-[26px] items-center justify-center rounded-md text-muted-foreground outline-none max-md:size-11 max-md:top-[-7px] [&>svg]:size-[15px]', C.hover, FOCUS_RING, className)}
      {...props}
    />
  );
}

const SidebarMenu = ({ className, ...props }: React.ComponentProps<'ul'>) => <ul data-slot="sidebar-menu" className={cn('flex w-full min-w-0 flex-col gap-px', className)} {...props} />;
const SidebarMenuItem = ({ className, ...props }: React.ComponentProps<'li'>) => <li data-slot="sidebar-menu-item" className={cn('group/menu-item relative', className)} {...props} />;

const MENU_BUTTON =
  'flex h-[30px] w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm font-medium text-sidebar-foreground/80 outline-none select-none max-md:h-11 disabled:opacity-50 [&>svg]:size-[17px] [&>svg]:shrink-0';

function SidebarMenuButton({ asChild = false, className, ...props }: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const Comp = asChild ? SlotPrimitive.Root : 'button';
  return <Comp data-slot="sidebar-menu-button" {...(asChild ? {} : { type: 'button' as const })} className={cn(MENU_BUTTON, C.hover, C.active, FOCUS_RING, className)} {...props} />;
}

/** A small button at the right end of a menu row (expand, more). Shown always on touch, on hover/focus otherwise. */
function SidebarMenuAction({ className, showOnHover = false, ...props }: React.ComponentProps<'button'> & { showOnHover?: boolean }) {
  return (
    <button
      type="button"
      data-slot="sidebar-menu-action"
      className={cn(
        'absolute top-[3px] right-1 flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none max-md:top-0 max-md:size-11 [&>svg]:size-[15px]',
        C.hover,
        FOCUS_RING,
        // Hidden until the row is hovered or focused, only where a pointer can hover (touch screens always show it).
        showOnHover && 'md:pointer-fine:opacity-0 md:pointer-fine:group-hover/menu-item:opacity-100 md:pointer-fine:group-focus-within/menu-item:opacity-100 md:pointer-fine:data-[state=open]:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

const SidebarMenuBadge = ({ className, ...props }: React.ComponentProps<'span'>) => (
  <span data-slot="sidebar-menu-badge" className={cn('pointer-events-none ml-auto shrink-0 text-xs text-muted-foreground tabular-nums', className)} {...props} />
);

const SidebarMenuSub = ({ className, ...props }: React.ComponentProps<'ul'>) => <ul data-slot="sidebar-menu-sub" className={cn('flex min-w-0 flex-col gap-px', className)} {...props} />;

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<'button'>) {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      data-slot="sidebar-trigger"
      className={cn('flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none max-md:size-11', C.hover, FOCUS_RING, className)}
      onClick={(e) => {
        onClick?.(e);
        toggleSidebar();
      }}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarProvider,
  SidebarTrigger,
};
