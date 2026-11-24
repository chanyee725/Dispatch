// The one page header (dashboard style, 2026-11-20): bar height, 15px title, and actions on the right.
// 대시보드, 세션 보드, 브랜치/사용량 and 최근 share it so every top-level screen starts the same way.
import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { SidebarTrigger } from './ui/sidebar';

export function PageHeader({ title, narrow, actions }: { title: ReactNode; narrow?: boolean; actions?: ReactNode }) {
  return (
    <header className="flex h-(--h-bar) shrink-0 items-center gap-3 pr-3 pl-5">
      {narrow && (
        <SidebarTrigger aria-label="메뉴 열기">
          <Menu className="size-[17px]" />
        </SidebarTrigger>
      )}
      <h1 className="m-0 min-w-0 shrink truncate text-base font-semibold tracking-[-0.01em]">{title}</h1>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {actions}
      </span>
    </header>
  );
}
