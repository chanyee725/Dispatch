import { useState } from "react";
import { ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api, useApp } from "@/store";
import type { Provider, ProviderStatus } from "@/types";

const LOGIN: Record<Provider, string> = { claude: "Claude 계정으로 로그인", openai: "ChatGPT 계정으로 로그인" };
const INSTALL: Record<Provider, string> = { claude: "Claude Code", openai: "Codex CLI" };

function StateLabel({ p }: { p: ProviderStatus }) {
  if (!p.installed) return <span className="inline-flex items-center gap-1.5 text-xs text-bad"><span className="size-1.5 rounded-full bg-bad" />설치 안 됨</span>;
  if (p.busy) return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />브라우저에서 로그인 중</span>;
  if (p.connected) return <span className="inline-flex items-center gap-1.5 text-xs font-medium"><span className="size-1.5 rounded-full bg-ok" />연결됨</span>;
  return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-muted-foreground" />연결 안 됨</span>;
}

function ProviderCard({ id, p }: { id: Provider; p: ProviderStatus }) {
  const models = useApp(s => s.models);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const call = <T,>(path: string, body?: unknown) =>
    api<T>("POST", `/api/providers/${id}/${path}`, body).catch((e: Error) => { toast.error(e.message); return null; });

  const connect = async () => {
    const res = await call<{ connected: boolean }>("login");
    if (res?.connected) toast.success(`${p.name}를 연결했어요`);
  };
  const saveKey = async () => {
    const k = key.trim();
    setKey("");
    if (!k) return;
    if (await call("key", { key: k })) { toast.success(`${p.name}를 연결했어요`); setKeyOpen(false); }
  };
  const disconnect = async () => { if (await call("logout")) toast.success(`${p.name} 연결을 해제했어요`); };

  const names = models.filter(m => m.provider === id).map(m => m.label);
  return (
    <section className={cn("flex flex-col gap-4 rounded-xl border bg-card p-4", p.connected && "border-ok/40")}>
      <header className="flex items-center gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{p.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{p.cli ?? "설치되지 않음"}</p>
        </div>
        <span className="ml-auto"><StateLabel p={p} /></span>
      </header>

      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">이 컴퓨터</dt>
        <dd>{!p.installed ? "—" : p.cliLoggedIn ? `${p.method ?? "로그인"}으로 로그인돼 있음` : "로그인 안 됨"}</dd>
        <dt className="text-muted-foreground">모델</dt><dd>{names.join(", ") || "—"}</dd>
      </dl>

      {p.busy && p.url && (
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-[var(--role-impl)] underline-offset-4 hover:underline">
          브라우저가 열리지 않았다면 로그인 페이지 열기<ExternalLink className="size-3.5" />
        </a>
      )}
      {p.error && <p className="text-sm text-bad">{p.error}</p>}

      {keyOpen && (
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); saveKey(); }}>
          <Input type="password" autoComplete="off" autoFocus value={key} onChange={e => setKey(e.target.value)} placeholder="OpenAI API 키" aria-label="API 키" />
          <Button type="submit" disabled={!key.trim()}>연결</Button>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!p.installed ? (
          <p className="text-sm text-muted-foreground">{INSTALL[id]}를 설치한 뒤 다시 열어 주세요.</p>
        ) : p.busy ? (
          <Button size="sm" variant="outline" onClick={() => call("cancel")}>로그인 취소</Button>
        ) : p.connected ? (
          <Button size="sm" variant="outline" onClick={disconnect}>연결 해제</Button>
        ) : p.cliLoggedIn ? (
          <>
            <Button size="sm" onClick={connect}>{p.name} 연결</Button>
            <span className="text-xs text-muted-foreground">이미 로그인된 계정을 그대로 써요</span>
          </>
        ) : (
          <>
            <Button size="sm" onClick={connect}>{LOGIN[id]}</Button>
            {p.keySupported && !keyOpen && <Button size="sm" variant="ghost" onClick={() => setKeyOpen(true)}><KeyRound />API 키로 연결</Button>}
          </>
        )}
      </div>
    </section>
  );
}

export function ProviderList() {
  const providers = useApp(s => s.providers);
  return (
    <div className="flex flex-col gap-3">
      {(Object.entries(providers) as [Provider, ProviderStatus][]).map(([id, p]) => <ProviderCard key={id} id={id} p={p} />)}
    </div>
  );
}

export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>에이전트 연결</DialogTitle>
          <DialogDescription>로그인은 각 CLI가 브라우저에서 처리해요. 연결을 해제해도 터미널의 CLI 로그인은 그대로 남아요.</DialogDescription>
        </DialogHeader>
        <ProviderList />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Shown in place of the board until at least one provider is connected.
export function LoginGate() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16 max-md:px-4 max-md:py-10">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">먼저 에이전트를 연결하세요</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          세션을 만들려면 Claude나 OpenAI Codex 중 하나 이상을 연결해야 해요. 로그인은 각 CLI가 브라우저에서 처리하고, Dispatch는 토큰이나 API 키를 저장하지 않아요.
        </p>
      </div>
      <ProviderList />
    </div>
  );
}
