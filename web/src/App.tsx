import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectDialog, LoginGate } from "@/components/ConnectDialog";
import { CreateSessionDialog } from "@/components/CreateSessionDialog";
import { SessionSheet } from "@/components/SessionSheet";
import { SessionsPage } from "@/components/SessionsPage";
import { Sidebar, type Page } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { UsagePage } from "@/components/UsagePage";
import { BranchesPage } from "@/components/BranchGraph";
import { SettingsPage } from "@/components/SettingsPage";
import { TvView } from "@/components/TvView";
import { connect, useApp } from "@/store";

const TITLES: Record<Page, string> = { sessions: "세션", branches: "브랜치", usage: "사용량", settings: "설정" };

export default function App() {
  const ready = useApp(s => s.ready);
  const providers = useApp(s => s.providers);
  const anyConnected = Object.values(providers).some(p => p.connected);
  const [page, setPage] = useState<Page>("sessions");
  const [creating, setCreating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, tick] = useState(0);
  // The always-on screen lives at #tv, so a wall display can open it directly and survive reloads.
  const [tv, setTv] = useState(() => location.hash === "#tv");
  useEffect(() => {
    const h = () => setTv(location.hash === "#tv");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const setTvMode = (on: boolean) => { location.hash = on ? "tv" : ""; };

  useEffect(() => { connect(); }, []);
  // Relative times ("3분 전", reset countdowns) refresh every 30s.
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 30_000); return () => clearInterval(t); }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid h-dvh grid-cols-[232px_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]">
        <Sidebar page={page} onPage={setPage} onConnect={() => setConnecting(true)} />
        <div className="flex min-h-0 min-w-0 flex-col">
          <TopBar title={TITLES[page]} onCreate={() => setCreating(true)} canCreate={anyConnected} onTv={() => setTvMode(true)} />
          <main className="min-h-0 flex-1 overflow-y-auto">
            {!ready ? (
              <p className="p-6 text-sm text-muted-foreground">Dispatch 서버에 연결하는 중이에요…</p>
            ) : !anyConnected && page === "sessions" ? (
              <LoginGate />
            ) : page === "sessions" ? (
              <SessionsPage onOpen={setOpenId} onCreate={() => setCreating(true)} onUsage={() => setPage("usage")} />
            ) : page === "branches" ? (
              <BranchesPage onOpen={setOpenId} />
            ) : page === "settings" ? (
              <SettingsPage />
            ) : (
              <UsagePage />
            )}
          </main>
        </div>
      </div>
      <CreateSessionDialog open={creating} onOpenChange={setCreating} onCreated={() => setPage("sessions")} />
      <ConnectDialog open={connecting} onOpenChange={setConnecting} />
      <SessionSheet id={openId} onClose={() => setOpenId(null)} />
      {tv && ready && <TvView onExit={() => setTvMode(false)} onOpen={id => { setTvMode(false); setOpenId(id); }} />}
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
