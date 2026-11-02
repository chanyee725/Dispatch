import { useEffect, useState } from "react";
import { FolderGit2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/store";

interface RunningProject {
  port: number;
  name: string;
  path: string;
  current: boolean;
}

// Lists the Dispatch servers running on this machine (one per project) and opens the chosen one.
// Each project keeps its own server and port, so switching is a plain navigation.
export function ProjectSwitcher({ name }: { name: string }) {
  const [projects, setProjects] = useState<RunningProject[]>([]);

  const load = () =>
    api<{ projects: RunningProject[] }>("GET", "/api/projects")
      .then(r => setProjects(r.projects))
      .catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const current = projects.find(p => p.current);
  const open = (port: string) => {
    if (+port === current?.port) return;
    window.location.href = `${window.location.protocol}//${window.location.hostname}:${port}/`;
  };

  return (
    <Select value={current ? String(current.port) : undefined} onValueChange={open} onOpenChange={o => o && load()}>
      <SelectTrigger size="sm" aria-label="프로젝트 선택" className="h-8 max-w-64 cursor-pointer gap-2 font-medium text-foreground">
        <FolderGit2 className="size-4" />
        <SelectValue placeholder={name}>{current?.name ?? name}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {projects.map(p => (
          <SelectItem key={p.port} value={String(p.port)} className="cursor-pointer">
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{p.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {p.path} · <span className="num">:{p.port}</span>
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
