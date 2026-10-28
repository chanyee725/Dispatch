import { FolderGit2, GitBranch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Meter } from "@/components/bits";
import { pct, until } from "@/lib/format";
import { useApp } from "@/store";

function Limit({ label, value, reset }: { label: string; value: number | null; reset: number | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex w-36 cursor-default flex-col gap-1 max-md:w-auto max-md:flex-1" tabIndex={0}>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="num font-medium">{pct(value)}</span>
          </div>
          <Meter value={value} />
        </div>
      </TooltipTrigger>
      <TooltipContent>{value == null ? "Claude 세션을 한 번 실행하면 표시돼요" : `초기화까지 ${until(reset)}`}</TooltipContent>
    </Tooltip>
  );
}

export function TopBar({ title, onCreate, canCreate }: { title: string; onCreate: () => void; canCreate: boolean }) {
  const project = useApp(s => s.project);
  const limits = useApp(s => s.limits);
  return (
    <header className="sticky top-0 z-10 flex items-center gap-6 border-b bg-background/85 px-6 py-3 backdrop-blur max-md:flex-wrap max-md:gap-3 max-md:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <h1 className="shrink-0 text-base font-semibold">{title}</h1>
        {project.name && (
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <FolderGit2 className="size-4 shrink-0" />
            <span className="shrink-0 font-medium text-foreground">{project.name}</span>
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
      <div className="flex shrink-0 items-center gap-5 max-md:w-full max-md:gap-3">
        <Limit label="5시간 한도" value={limits.five} reset={limits.fiveReset} />
        <Limit label="주간 한도" value={limits.seven} reset={limits.sevenReset} />
        <Button onClick={onCreate} aria-label="새 세션" disabled={!canCreate} title={canCreate ? undefined : "먼저 에이전트를 연결하세요"}>
          <Plus />
          <span className="max-sm:hidden">새 세션</span>
        </Button>
      </div>
    </header>
  );
}
