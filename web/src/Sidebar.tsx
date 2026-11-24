// App sidebar: the project's name, the 세션 보드 views (세션 보드 S, 브랜치, 사용량), the project folders (each opens the
// board scoped to it), saved chats (SidebarHistory), then one row per model with its connection status (SidebarModels.tsx),
// settings and the theme switch. Built from the shadcn Sidebar (components/ui/sidebar.tsx).
// The current view carries aria-current="page", which also drives its look (weight + fill, never colour alone).
import { ChartColumn, FolderClosed, GitBranch, LayoutGrid } from 'lucide-react';
import type { ComponentType } from 'react';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from './components/ui/sidebar';
import { useProjectList } from './dispatch/useProjectList';
import type { BoardTab, Section } from './projectNav';
import { SettingsEntry } from './settings/SettingsEntry';
import { SidebarModels } from './SidebarModels';
import { SidebarHistory } from './shell/SidebarHistory';
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
/** The 세션 tab and its 타임라인 card are one screen. */
const sessionsTab = (t: BoardTab) => t === 'sessions' || t === 'timeline';

function Row({ id, label, icon: Icon, current, onClick }: { id: string; label: string; icon: ComponentType<{ 'aria-hidden'?: boolean }>; current: boolean; onClick: () => void }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton aria-current={current ? 'page' : undefined} onClick={onClick} data-nav={id}>
        <Icon aria-hidden />
        <span className={NAME} title={label}>
          {label}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function Sidebar(p: Props) {
  const [folders, listState] = useProjectList();
  const s = p.section;
  const board = (tab: BoardTab, folder?: string | null) => p.onSection({ kind: 'board', tab, folder });
  return (
    <SidebarRoot label="사이드바">
      <SidebarHeader className="flex-row items-center gap-1 pt-[9px]">
        <ProjectName name={p.project} />
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
          ) : (
            <SidebarMenu>
              {folders.map((f) => (
                <Row key={f.path} id={`folder:${f.path}`} label={f.name || f.path} icon={FolderClosed} current={sessionsTab(s.tab) && s.folder === f.path} onClick={() => board('sessions', f.path)} />
              ))}
            </SidebarMenu>
          )}
        </SidebarGroup>
        <SidebarHistory />
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
