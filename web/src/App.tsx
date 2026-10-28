import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectDialog } from "@/components/ConnectDialog";
import { CreateSessionDialog } from "@/components/CreateSessionDialog";
import { SessionSheet } from "@/components/SessionSheet";
import { SessionsPage } from "@/components/SessionsPage";
import { Sidebar, type Page } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { UsagePage } from "@/components/UsagePage";
import { connect, useApp } from "@/store";

const TITLES: Record<Page, string> = { sessions: "세션", usage: "사용량" };

export default function App() {
  const ready = useApp(s => s.ready);
  const [page, setPage] = useState<Page>("sessions");
  const [creating, setCreating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => { connect(); }, []);
  // Relative times ("3분 전", reset countdowns) refresh every 30s.
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 30_000); return () => clearInterval(t); }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid h-dvh grid-cols-[232px_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]">
        <Sidebar page={page} onPage={setPage} onConnect={() => setConnecting(true)} />
        <div className="flex min-h-0 min-w-0 flex-col">
          <TopBar title={TITLES[page]} onCreate={() => setCreating(true)} />
          <main className="min-h-0 flex-1 overflow-y-auto">
            {!ready ? (
              <p className="p-6 text-sm text-muted-foreground">Dispatch 서버에 연결하는 중이에요…</p>
            ) : page === "sessions" ? (
              <SessionsPage onOpen={setOpenId} onCreate={() => setCreating(true)} />
            ) : (
              <UsagePage />
            )}
          </main>
        </div>
      </div>
      <CreateSessionDialog open={creating} onOpenChange={setCreating} onCreated={() => setPage("sessions")} />
      <ConnectDialog open={connecting} onOpenChange={setConnecting} />
      <SessionSheet id={openId} onClose={() => setOpenId(null)} />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
