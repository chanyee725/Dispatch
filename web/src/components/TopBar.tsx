import { GitBranch, Plus, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ProviderLimits } from "@/components/ProviderLimits";
import { ClearAllButton } from "@/components/ClearAllButton";
import { ClearDoneButton } from "@/components/ClearDoneButton";
import { useApp } from "@/store";

export function TopBar({ title, onCreate, canCreate, onTv }: { title: string; onCreate: () => void; canCreate: boolean; onTv?: () => void }) {
  const project = useApp(s => s.project);
  return (
    <header className="sticky top-0 z-10 flex items-center gap-6 border-b bg-background/85 px-6 py-3 backdrop-blur max-md:flex-wrap max-md:gap-3 max-md:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <h1 className="sr-only">{title}</h1>
        {project.name && (
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <ProjectSwitcher name={project.name} />
            <span className="truncate max-lg:hidden" title={project.path}>{project.path}</span>
            {project.branch && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
                <GitBranch className="size-3" />
                {project.branch}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 max-md:w-full max-md:gap-2">
        <ProviderLimits />
        <Button onClick={onCreate} aria-label="새 세션" disabled={!canCreate} title={canCreate ? undefined : "먼저 에이전트를 연결하세요"}>
          <Plus />
          <span className="max-sm:hidden">새 세션</span>
        </Button>
        {onTv && (
          <Button variant="outline" onClick={onTv} aria-label="상시 화면" title="상시 화면 (TV)">
            <Tv />
            <span className="max-xl:hidden">상시 화면</span>
          </Button>
        )}
        <ClearDoneButton />
        <ClearAllButton />
      </div>
    </header>
  );
}
