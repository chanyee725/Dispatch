// App sidebar: board navigation, running Dispatch services, model status, settings and theme.
import { ChartColumn, FolderClosed, GitBranch, LayoutGrid } from 'lucide-react';
import { useEffect, useId, useState, type ComponentType } from 'react';
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
import { api, useDispatch } from './dispatch/store';
import type { BoardTab, Section } from './projectNav';
import { SettingsEntry } from './settings/SettingsEntry';
import { SidebarModels } from './SidebarModels';
import { ThemeSwitch } from './ThemeSwitch';
import { ProjectName } from './ProjectName';
import type { Theme, ThemePref } from './theme';

type Props = {
  project: string | null;
  section: Section;
  onSection: (s: Section) => void;
  themePref: ThemePref;
  onThemePref: (t: ThemePref) => void;
  systemTheme: Theme;
};

const NAME = 'min-w-0 flex-1 truncate';

function Row({ id, label, icon: Icon, current, onClick }: {
  id: string; label: string; icon: ComponentType<{ 'aria-hidden'?: boolean }>; current: boolean; onClick: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton aria-current={current ? 'page' : undefined} onClick={onClick} data-nav={id}>
        <Icon aria-hidden />
        <span className={NAME}>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

type ServiceProject = { name: string; port: number; current: boolean };
const SERVICE_REFRESH_MS = 15_000;
const SERVICE_LABELS = new Map([
  ['keeper2-bridge', 'Keeper2 Bridge'],
  ['sim-client', 'Sim Client'],
  ['sim-studio', 'Sim Studio'],
]);

function useServiceProjects(online: boolean) {
  const [projects, setProjects] = useState<ServiceProject[] | null>(null);
  useEffect(() => {
    setProjects(null);
    if (!online) return;
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const result = await api<{ projects?: ServiceProject[] }>('GET', '/api/service-projects', undefined, request.signal).catch(() => null);
      if (request.signal.aborted) return;
      setProjects(result?.projects ?? []);
      timer = setTimeout(refresh, SERVICE_REFRESH_MS);
    }
    void refresh();
    return () => {
      request.abort();
      clearTimeout(timer);
    };
  }, [online]);
  return online ? projects : null;
}

export function Sidebar(p: Props) {
  const { isMobile, setOpenMobile } = useSidebar();
  const ready = useDispatch((state) => state.ready);
  const online = useDispatch((state) => state.online);
  const unavailable = useDispatch((state) => state.unavailable);
  const projects = useServiceProjects(online);
  const projectLabelId = useId();
  const names = new Map<string, number>();
  const s = p.section;
  const board = (tab: BoardTab, folder?: string | null) => p.onSection({ kind: 'board', tab, folder });
  return (
    <SidebarRoot label="사이드바">
      <SidebarHeader className="gap-0 pt-[9px]">
        <ProjectName name={p.project} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          <Row id="board" label="세션 보드" icon={LayoutGrid} current={(s.tab === 'sessions' || s.tab === 'timeline') && s.folder === undefined} onClick={() => board('sessions')} />
          <Row id="branches" label="브랜치" icon={GitBranch} current={s.tab === 'branches'} onClick={() => board('branches')} />
          <Row id="usage" label="사용량" icon={ChartColumn} current={s.tab === 'usage'} onClick={() => board('usage', s.folder)} />
        </SidebarMenu>
        <SidebarGroup className="mt-3">
          <nav aria-labelledby={projectLabelId}>
            <SidebarGroupLabel>
              <span id={projectLabelId}>프로젝트</span>
              {projects && <SidebarMenuBadge>{projects.length}</SidebarMenuBadge>}
            </SidebarGroupLabel>
            {projects?.length ? (
              <SidebarMenu>
                {projects.map(({ name, port, current }) => {
                  const occurrence = names.get(name) ?? 0;
                  names.set(name, occurrence + 1);
                  const label = SERVICE_LABELS.get(name) ?? name;
                  return (
                    <SidebarMenuItem key={`${name}:${occurrence}`}>
                      <SidebarMenuButton asChild aria-current={current ? 'location' : undefined} className="aria-[current=location]:font-semibold">
                        <a href={current ? '/#board' : `http://127.0.0.1:${port}/#board`} onClick={() => { if (isMobile) setOpenMobile(false); }}>
                          <FolderClosed aria-hidden />
                          <span className={NAME} title={label}>{label}</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            ) : (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {unavailable || projects ? '확인된 서비스가 없어요.' : ready && !online ? '다시 연결하는 중이에요…' : '서비스를 확인하는 중이에요…'}
              </p>
            )}
          </nav>
        </SidebarGroup>
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
