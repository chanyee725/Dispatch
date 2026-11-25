// App sidebar: the project's name, the 세션 보드 views (세션 보드 S, 브랜치, 사용량), the project folders (each opens the
// board scoped to it), then one row per model with its connection status (SidebarModels.tsx),
// settings and the theme switch. Built from the shadcn Sidebar (components/ui/sidebar.tsx).
// The current view carries aria-current="page", which also drives its look (weight + fill, never colour alone).
import { ChartColumn, FolderClosed, GitBranch, LayoutGrid } from 'lucide-react';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import type { Session } from '../../shared/dispatch/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from './components/ui/sidebar';
import { projectOf, UNFILED } from './dispatch/lib/folder';
import { isOpen, stateOf, STATE, TONE_TEXT } from './dispatch/lib/format';
import { api, useDispatch } from './dispatch/store';
import { useProjectList } from './dispatch/useProjectList';
import { openAgentLive, useAgentLiveTarget } from './live/store';
import type { BoardTab, Section } from './projectNav';
import { SettingsEntry } from './settings/SettingsEntry';
import { SidebarModels } from './SidebarModels';
import { ThemeSwitch } from './ThemeSwitch';
import { ProjectName } from './ProjectName';
import type { Theme, ThemePref } from './theme';

type Props = {
  /** The project's name, shown top-left (#778); null while it loads. */
  project: string | null;
  section: Section;
  onSection: (s: Section) => void;
  /** The theme switch at the bottom: the chosen theme, its setter, and the system's scheme (shown on 시스템). */
  themePref: ThemePref;
  onThemePref: (t: ThemePref) => void;
  systemTheme: Theme;
};

const NAME = 'min-w-0 flex-1 truncate';
const ALL = 'all';
const leadValue = (id: string) => `lead:${id}`;
/** The 세션 tab and its 타임라인 card are one screen. */
const sessionsTab = (t: BoardTab) => t === 'sessions' || t === 'timeline';

function Row({ id, label, icon: Icon, current, count, onClick }: {
  id: string; label: string; icon: ComponentType<{ 'aria-hidden'?: boolean }>; current: boolean; count?: number; onClick: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton aria-current={current ? 'page' : undefined} onClick={onClick} data-nav={id}>
        <Icon aria-hidden />
        <span className={NAME} title={label}>
          {label}
        </span>
        {count !== undefined && <SidebarMenuBadge>활성 {count}개</SidebarMenuBadge>}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** The server reports the port for its own git project. Workspace folders share its session stream. */
function useProjectPort(online: boolean) {
  const [port, setPort] = useState<number | null>(null);
  useEffect(() => {
    setPort(null);
    if (!online) return;
    const request = new AbortController();
    void api<{ projects: { current: boolean; port: number }[] }>('GET', '/api/projects', undefined, request.signal).then(
      ({ projects }) => {
        if (!request.signal.aborted) setPort(projects.find((p) => p.current)?.port || null);
      },
      () => {},
    );
    return () => request.abort();
  }, [online]);
  return online ? port : null;
}

function teamOf(session: Session, byId: ReadonlyMap<string, Session>) {
  const leads: Session[] = [];
  const seen = new Set([session.id]);
  let parent = session.parent;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const ancestor = byId.get(parent);
    if (!ancestor) break;
    if (ancestor.canSpawn) leads.push(ancestor);
    parent = ancestor.parent;
  }
  return { leads, unresolved: Boolean(parent) };
}

function SidebarSessions({ all, sessions }: { all: readonly Session[]; sessions: readonly Session[] }) {
  const [pickedLead, setPickedLead] = useState(ALL);
  const { isMobile, setOpenMobile } = useSidebar();
  const current = useAgentLiveTarget();
  const { rows, leads } = useMemo(() => {
    const byId = new Map(all.map((s) => [s.id, s]));
    const options = new Map<string, Session>();
    const rows = sessions.map((s) => {
      const team = teamOf(s, byId);
      if (s.canSpawn) options.set(s.id, s);
      for (const lead of team.leads) options.set(lead.id, lead);
      return { session: s, ...team };
    });
    const leads = [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { rows, leads };
  }, [all, sessions]);
  const lead = leads.find((s) => leadValue(s.id) === pickedLead);
  const visible = lead ? rows.filter((row) => row.leads.some((s) => s.id === lead.id)) : rows;

  return (
    <SidebarGroup className="mt-3">
      <SidebarGroupLabel>세션</SidebarGroupLabel>
      <Select value={lead ? pickedLead : ALL} onValueChange={setPickedLead}>
        <SelectTrigger aria-label="팀장 필터" className="mx-2 mb-1 w-auto border-sidebar-border text-sidebar-foreground max-md:h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value={ALL}>전체</SelectItem>
          {leads.map((s) => <SelectItem key={s.id} value={leadValue(s.id)}>{s.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {visible.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">{lead ? '하위 세션이 없어요.' : '세션이 없어요.'}</p>
      ) : (
        <SidebarMenu aria-label={lead ? `${lead.name} 하위 세션` : '전체 세션'}>
          {visible.map(({ session: s, leads: parents, unresolved }) => {
            const state = STATE[stateOf(s)];
            const team = s.canSpawn ? s.roleName : parents[0]?.name ?? (unresolved || s.parent ? '팀장 확인 필요' : '독립');
            return (
              <SidebarMenuItem key={s.id}>
                <SidebarMenuButton
                  aria-current={s.id === current ? 'true' : undefined}
                  data-sidebar-session={s.id}
                  className="gap-1.5 text-xs aria-[current=true]:bg-card aria-[current=true]:font-semibold"
                  onClick={(e) => {
                    if (isMobile) setOpenMobile(false);
                    openAgentLive(s.id, { from: 'sidebar', trigger: e.currentTarget });
                  }}
                >
                  <span className={NAME} title={s.name}>{s.name}</span>
                  <span className="max-w-[40%] truncate text-muted-foreground" title={team}>{team}</span>
                  <SidebarMenuBadge className={TONE_TEXT[state.tone]}>{state.label}</SidebarMenuBadge>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
}

export function Sidebar(p: Props) {
  const [folders, listState] = useProjectList();
  const all = useDispatch((state) => state.sessions);
  const ready = useDispatch((state) => state.ready);
  const online = useDispatch((state) => state.online);
  const port = useProjectPort(online);
  const s = p.section;
  const board = (tab: BoardTab, folder?: string | null) => p.onSection({ kind: 'board', tab, folder });
  const { byFolder, counts, active } = useMemo(() => {
    const known = new Set(folders.map((f) => f.path));
    const byFolder = new Map<string | null, Session[]>();
    const counts = new Map<string | null, number>();
    let active = 0;
    for (const session of all) {
      const folder = listState === 'ready' ? projectOf(session, known) : session.folder ?? null;
      const group = byFolder.get(folder);
      if (group) group.push(session);
      else byFolder.set(folder, [session]);
      if (isOpen(session)) {
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
        active++;
      }
    }
    return { byFolder, counts, active };
  }, [all, folders, listState]);
  const scoped = s.folder === undefined ? all : byFolder.get(s.folder) ?? [];
  const unfiled = listState === 'ready' && (byFolder.has(null) || s.folder === null);
  return (
    <SidebarRoot label="사이드바">
      <SidebarHeader className="gap-0 pt-[9px]">
        <ProjectName name={p.project} />
        {ready && (
          <p className="flex flex-wrap gap-x-2 px-2 pb-1 text-xs text-muted-foreground tabular-nums">
            {port !== null && <span>포트 {port}</span>}
            <span>활성 {active}개</span>
            {!online && <span>재연결 중</span>}
          </p>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          <Row id="board" label="세션 보드" icon={LayoutGrid} current={sessionsTab(s.tab) && s.folder === undefined} onClick={() => board('sessions')} />
          <Row id="branches" label="브랜치" icon={GitBranch} current={s.tab === 'branches'} onClick={() => board('branches')} />
          <Row id="usage" label="사용량" icon={ChartColumn} current={s.tab === 'usage'} onClick={() => board('usage', s.folder)} />
        </SidebarMenu>
        <SidebarGroup className="mt-3">
          <SidebarGroupLabel>프로젝트</SidebarGroupLabel>
          {folders.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">{listState === 'loading' ? '불러오는 중이에요…' : listState === 'failed' ? '목록을 불러오지 못했어요.' : '아직 프로젝트 폴더가 없어요.'}</p>
          ) : null}
          {(folders.length > 0 || unfiled) && (
            <SidebarMenu>
              {folders.map((f) => (
                <Row key={f.path} id={`folder:${f.path}`} label={f.name || f.path} icon={FolderClosed} current={sessionsTab(s.tab) && s.folder === f.path} count={ready ? counts.get(f.path) ?? 0 : undefined} onClick={() => board('sessions', f.path)} />
              ))}
              {unfiled && <Row id="unfiled" label={UNFILED} icon={FolderClosed} current={sessionsTab(s.tab) && s.folder === null} count={counts.get(null) ?? 0} onClick={() => board('sessions', null)} />}
            </SidebarMenu>
          )}
        </SidebarGroup>
        {ready && !(s.folder === null && listState === 'loading') && <SidebarSessions all={all} sessions={scoped} />}
      </SidebarContent>
      <SidebarFooter>
        <SidebarModels />
        <SidebarMenu className="mt-3">
          <SidebarMenuItem>
            <SettingsEntry />
          </SidebarMenuItem>
        </SidebarMenu>
        <ThemeSwitch pref={p.themePref} onPref={p.onThemePref} system={p.systemTheme} />
      </SidebarFooter>
    </SidebarRoot>
  );
}
