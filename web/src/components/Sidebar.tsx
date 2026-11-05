import { BarChart3, GitBranch, LayoutGrid, Monitor, Moon, PlugZap, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isOpen } from "@/lib/format";
import { useApp } from "@/store";
import { useTheme, type ThemeChoice } from "@/lib/theme";

export type Page = "sessions" | "branches" | "usage";

const NAV: { id: Page; label: string; icon: typeof LayoutGrid }[] = [
  { id: "sessions", label: "세션", icon: LayoutGrid },
  { id: "branches", label: "브랜치", icon: GitBranch },
  { id: "usage", label: "사용량", icon: BarChart3 },
];

// The mark: three role-coloured bars, the same rails the session board uses.
function Mark() {
  return (
    <span className="flex h-5 items-end gap-[3px]" aria-hidden>
      <span className="h-3 w-[5px] rounded-sm" style={{ background: "var(--role-lead)" }} />
      <span className="h-5 w-[5px] rounded-sm" style={{ background: "var(--role-impl)" }} />
      <span className="h-4 w-[5px] rounded-sm" style={{ background: "var(--role-test)" }} />
    </span>
  );
}

export function Sidebar({ page, onPage, onConnect }: { page: Page; onPage: (p: Page) => void; onConnect: () => void }) {
  const sessions = useApp(s => s.sessions);
  const providers = useApp(s => s.providers);
  const online = useApp(s => s.online);
  const open = sessions.filter(isOpen).length;
  const list = (["claude", "openai", "gemini"] as const).map(id => (providers as Record<string, (typeof providers)[keyof typeof providers]>)[id]).filter(Boolean);
  const allConnected = list.length > 0 && list.every(p => p.connected);

  return (
    <aside className="flex flex-col gap-1 border-r bg-card/60 px-3 py-4 max-md:flex-row max-md:items-center max-md:border-r-0 max-md:border-b max-md:py-2">
      <div className="flex items-center gap-2.5 px-2 pb-5 max-md:pb-0 max-md:pl-1">
        <Mark />
        <span className="text-[15px] font-semibold tracking-tight max-sm:hidden">Dispatch</span>
      </div>

      <nav className="flex flex-col gap-0.5 max-md:flex-row">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onPage(id)}
            aria-current={page === id ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              page === id ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
            {id === "sessions" && open > 0 && <span className="num ml-auto text-xs text-muted-foreground max-md:ml-1">{open}</span>}
          </button>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t pt-3 max-md:mt-0 max-md:ml-auto max-md:border-t-0 max-md:pt-0">
        <ul className="flex flex-col gap-1.5 px-2 max-md:hidden">
          {list.map(p => (
            <li key={p.name} className="flex items-center gap-2 text-[13px]">
              <span
                className="size-1.5 rounded-full"
                style={{ background: !p.installed ? "var(--bad)" : p.busy ? "var(--warn)" : p.connected ? "var(--ok)" : "var(--muted-foreground)" }}
              />
              {p.name}
              <span className="ml-auto text-xs text-muted-foreground">
                {!p.installed ? "설치 안 됨" : p.busy ? "로그인 중" : p.connected ? "연결됨" : "연결 안 됨"}
              </span>
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" onClick={onConnect} aria-label={allConnected ? "연결 관리" : "연결하기"}>
          <PlugZap />
          <span className="max-sm:hidden">{allConnected ? "연결 관리" : "연결하기"}</span>
        </Button>
        {!online && (
          <div className="flex items-center gap-1.5 px-2 text-xs text-bad max-md:hidden">
            <span className="size-1.5 rounded-full bg-bad" />
            서버 연결 끊김
          </div>
        )}
        <ThemeSwitch />
      </div>
    </aside>
  );
}

const THEMES: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "시스템", icon: Monitor },
  { id: "light", label: "라이트", icon: Sun },
  { id: "dark", label: "다크", icon: Moon },
];

function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div role="radiogroup" aria-label="테마" className="flex gap-0.5 rounded-lg bg-muted p-0.5 max-md:hidden">
      {THEMES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={theme === id}
          aria-label={label}
          title={label}
          onClick={() => setTheme(id)}
          className={cn(
            "flex h-7 flex-1 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            theme === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
