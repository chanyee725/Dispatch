// The app shell: the sidebar (project folders, saved chats, models, settings, theme) and the 세션 보드 beside it, with
// the agent live panel, the chat dock, dialogs and toasts over them. The address picks the board's tab and scope
// (`#board…`, projectNav.ts); `#chat` opens the chat dock.
import { lazy, Suspense, useCallback, useState } from 'react';
import { Sidebar } from './Sidebar';
import { SidebarInset, SidebarProvider } from './components/ui/sidebar';
import { ActivityAlerts } from './activity/ActivityAlerts';
import { AgentLiveHost } from './live/AgentLivePanel';
import { ChatDock } from './chat/ChatDock';
import { Toaster } from './components/ui/sonner';
import type { BoardExtra, BoardSection, Section } from './projectNav';
import { LazyBoundary } from './LazyBoundary';
import { useTheme } from './theme';
import { AppDialogHost } from './AppDialogHost';
import { useNarrow } from './root/useNarrow';
import { useHashNavigation } from './root/useHashNavigation';
import { useShellShortcuts } from './root/useShortcuts';
import { useStartup } from './root/useStartup';
import { useWorkspaceEvents } from './root/useWorkspaceEvents';
import { initialBoard, setBoardHash } from './root/hashRoute';
// The 세션 보드 (#731) loads on its own, so the shell paints first.
const SessionBoard = lazy(() => import('./dispatch/SessionBoard'));

export function App() {
  const [theme, , themePref, setThemePref, systemTheme] = useTheme();
  const narrow = useNarrow();
  const [navOpen, setNavOpen] = useState(false);
  // The one project this server belongs to (#778): its folder name, shown top-left.
  const [projectName, setProjectName] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(() => {
    const b = initialBoard();
    return { kind: 'board', tab: b?.tab ?? 'sessions', folder: b?.folder };
  });
  // 상시 화면 / 설정 asked for by a board address (#board=tv, #board=settings); the board handles it once.
  const [boardExtra, setBoardExtra] = useState<BoardExtra | null>(() => initialBoard()?.extra ?? null);
  // A session to open on the board, from a toast (`n` makes each request new).
  const [boardOpen, setBoardOpen] = useState<{ id: string; n: number } | null>(null);

  useStartup(setProjectName);
  useHashNavigation({ setSection, setBoardExtra });
  useWorkspaceEvents();

  const showSection = useCallback(
    (s: BoardSection) => {
      setSection(s);
      setBoardHash(s);
      if (narrow) setNavOpen(false);
    },
    [narrow],
  );
  const showBoard = useCallback(() => showSection({ kind: 'board', tab: 'sessions' }), [showSection]);
  useShellShortcuts(showBoard);
  // 세션 열기 on a toast: the board (keeping its tab and scope) opens with that session.
  const openBoardSession = useCallback(
    (id: string) => {
      setBoardOpen({ id, n: Date.now() });
      if (narrow) setNavOpen(false);
    },
    [narrow],
  );
  // The board's own header (tabs, scope) moves within the board.
  const routeBoard = useCallback((tab: BoardSection['tab'], folder: string | null | undefined) => showSection({ kind: 'board', tab, folder }), [showSection]);
  const extraDone = useCallback(() => {
    setBoardExtra(null);
    // Drop `#board=tv` / `=settings` from the address so a reload does not open it again.
    setSection((s) => {
      setBoardHash(s, true);
      return s;
    });
  }, []);
  const dark = theme === 'dark';
  return (
    <SidebarProvider openMobile={navOpen} onOpenMobileChange={setNavOpen}>
      <Sidebar project={projectName} section={section} onSection={showSection} themePref={themePref} onThemePref={setThemePref} systemTheme={systemTheme} />
      <ActivityAlerts onSession={openBoardSession} />
      <AgentLiveHost />
      <ChatDock folder={section.folder ?? null} />
      <AppDialogHost />
      <Toaster dark={dark} />
      <SidebarInset>
        <LazyBoundary>
          <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">불러오는 중이에요…</p>}>
            <SessionBoard tab={section.tab} folder={section.folder} onRoute={routeBoard} openRequest={boardOpen} extra={boardExtra} onExtraDone={extraDone} narrow={narrow} />
          </Suspense>
        </LazyBoundary>
      </SidebarInset>
    </SidebarProvider>
  );
}
