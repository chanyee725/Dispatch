import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FolderGit2, Minus, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PERM_LABEL, pct, roleColor, until } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api, useApp } from "@/store";
import type { Role } from "@/types";

interface Row { key: number; role: string; model: string; effort: string; perm: string; prompt: string; n: number; open: boolean }

let keySeq = 0;
const rowFor = (r: Role, n = 1): Row => ({ key: ++keySeq, role: r.id, model: r.model, effort: "default", perm: r.perm, prompt: r.prompt, n, open: false });

export function CreateSessionDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const roles = useApp(s => s.roles);
  const models = useApp(s => s.models);
  const providers = useApp(s => s.providers);
  const perms = useApp(s => s.perms);
  const project = useApp(s => s.project);
  const limits = useApp(s => s.limits);

  const [rows, setRows] = useState<Row[]>([]);
  const [prompt, setPrompt] = useState("");
  const [worktree, setWorktree] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && rows.length === 0 && roles.length) {
      const pick = (id: string) => roles.find(r => r.id === id);
      setRows(["lead", "impl", "review"].map(pick).filter((r): r is Role => !!r).map(r => rowFor(r)));
    }
    if (open) setError(null);
  }, [open, roles]);

  const modelOf = (id: string) => models.find(m => m.id === id);
  const update = (key: number, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const total = rows.reduce((a, r) => a + r.n, 0);
  const disconnected = rows.some(r => !providers[modelOf(r.model)?.provider ?? "claude"]?.connected);
  const notices = useMemo(() => {
    const out: string[] = [];
    if (disconnected) out.push("연결되지 않은 서비스의 모델이 있어요. 왼쪽 아래 연결하기에서 먼저 로그인하세요.");
    if (limits.five != null && limits.five >= 0.85 && rows.some(r => modelOf(r.model)?.provider === "claude"))
      out.push(`5시간 한도를 ${pct(limits.five)} 썼어요. Claude 세션 여러 개를 동시에 돌리면 ${until(limits.fiveReset)} 안에 한도에 걸릴 수 있어요.`);
    if (!worktree && total > 1) out.push("worktree 없이 여러 세션이 같은 폴더를 고치면 서로 충돌해요.");
    if (rows.some(r => modelOf(r.model)?.provider === "openai" && (r.perm === "manual" || r.perm === "plan")))
      out.push("Codex는 실행 중에 승인을 받을 수 없어서 매번 승인·계획만 모드는 읽기 전용으로 실행돼요.");
    return out;
  }, [rows, worktree, limits, providers, models]);

  const summary = useMemo(() => {
    const by = new Map<string, number>();
    rows.forEach(r => { const l = modelOf(r.model)?.label ?? r.model; by.set(l, (by.get(l) ?? 0) + r.n); });
    return [...by].map(([l, n]) => `${l} ${n}개`).join(", ");
  }, [rows, models]);

  const submit = async () => {
    if (!prompt.trim()) { setError("모든 세션에 보낼 공통 프롬프트를 입력하세요."); return; }
    setBusy(true); setError(null);
    try {
      const res = await api<{ sessions: unknown[] }>("POST", "/api/sessions", {
        commonPrompt: prompt.trim(), worktree,
        items: rows.map(r => ({ role: r.role, model: r.model, effort: r.effort === "default" ? null : r.effort, perm: r.perm, prompt: r.prompt, n: r.n })),
      });
      toast.success(`세션 ${res.sessions.length}개를 시작했어요`);
      setPrompt("");
      onOpenChange(false);
      onCreated();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const groups = (["claude", "openai"] as const).filter(p => models.some(m => m.provider === p));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 pt-5 pb-4">
          <DialogTitle>새 세션</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <FolderGit2 className="size-3.5" />
            <span className="font-medium text-foreground">{project.name}</span>
            <span className="truncate">에서 실행돼요</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-6 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="common-prompt">공통 프롬프트</Label>
            <Textarea id="common-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
              placeholder="예: 결제 모듈의 환불 로직을 정리하고 테스트를 보강해줘. 끝나면 변경 요약을 남겨." />
            <p className="text-xs text-muted-foreground">모든 세션이 이 메시지로 시작해요. 역할별 지시는 아래 연필 버튼으로 바꿀 수 있어요.</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>세션 구성</Label>
              <Button size="sm" variant="ghost" onClick={() => setRows(rs => [...rs, rowFor(roles[rs.length % roles.length])])}><Plus />역할 추가</Button>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,.9fr)_minmax(0,1.2fr)_auto_auto] gap-2 px-3 text-xs text-muted-foreground max-md:hidden">
              <span className="pl-4">역할</span><span>모델</span><span>추론 강도</span><span>권한</span><span className="w-[104px]">개수</span><span className="w-[72px]" />
            </div>
            <ul className="flex flex-col gap-2">
              {rows.map(r => {
                const m = modelOf(r.model);
                return (
                  <li key={r.key} className="rounded-xl border bg-muted/30">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,.9fr)_minmax(0,1.2fr)_auto_auto] items-center gap-2 p-2 pl-3 max-md:grid-cols-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: roleColor(r.role) }} />
                        <Select value={r.role} onValueChange={v => { const role = roles.find(x => x.id === v)!; update(r.key, { ...rowFor(role, r.n), key: r.key, open: r.open }); }}>
                          <SelectTrigger className="w-full bg-background" aria-label="역할"><SelectValue /></SelectTrigger>
                          <SelectContent>{roles.map(x => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <Select value={r.model} onValueChange={v => update(r.key, { model: v, effort: "default" })}>
                        <SelectTrigger className="w-full bg-background" aria-label="모델"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {groups.map(p => (
                            <SelectGroup key={p}>
                              <SelectLabel>{providers[p]?.name ?? p}{providers[p]?.connected ? "" : " · 연결 필요"}</SelectLabel>
                              {models.filter(x => x.provider === p).map(x => (
                                <SelectItem key={x.id} value={x.id} disabled={!providers[p]?.connected}>{x.label}</SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={r.effort} onValueChange={v => update(r.key, { effort: v })}>
                        <SelectTrigger className="w-full bg-background" aria-label="추론 강도"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">기본{m?.defaultEffort ? ` (${m.defaultEffort})` : ""}</SelectItem>
                          {m?.efforts.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={r.perm} onValueChange={v => update(r.key, { perm: v })}>
                        <SelectTrigger className="w-full bg-background" aria-label="권한"><SelectValue /></SelectTrigger>
                        <SelectContent>{perms.map(p => <SelectItem key={p} value={p}>{PERM_LABEL[p] ?? p}</SelectItem>)}</SelectContent>
                      </Select>
                      <div className="flex h-9 w-[104px] items-center rounded-md border bg-background">
                        <Button size="icon" variant="ghost" className="size-8" aria-label="줄이기" onClick={() => update(r.key, { n: Math.max(1, r.n - 1) })}><Minus /></Button>
                        <span className="num flex-1 text-center text-sm">{r.n}</span>
                        <Button size="icon" variant="ghost" className="size-8" aria-label="늘리기" onClick={() => update(r.key, { n: Math.min(10, r.n + 1) })}><Plus /></Button>
                      </div>
                      <div className="flex w-[72px] justify-end">
                        <Button size="icon" variant="ghost" aria-label="역할 프롬프트 편집" aria-pressed={r.open}
                          className={cn(r.open && "bg-accent")} onClick={() => update(r.key, { open: !r.open })}><Pencil /></Button>
                        <Button size="icon" variant="ghost" aria-label="이 줄 지우기" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}><X /></Button>
                      </div>
                    </div>
                    {r.open && (
                      <div className="px-3 pb-3 pl-6">
                        <Textarea value={r.prompt} onChange={e => update(r.key, { prompt: e.target.value })} rows={3} className="bg-background"
                          aria-label={`${roles.find(x => x.id === r.role)?.name} 역할 프롬프트`} />
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {m?.provider === "openai" ? "Codex는 첫 메시지 앞에 붙여서 보내요." : "Claude의 시스템 프롬프트에 덧붙여요."}
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
              {rows.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">역할을 하나 이상 추가하세요.</li>}
            </ul>
          </div>

          <label className="flex items-start gap-3 text-sm">
            <Checkbox checked={worktree} onCheckedChange={v => setWorktree(v === true)} className="mt-0.5" />
            <span>
              세션마다 git worktree 분리
              <span className="block text-xs text-muted-foreground">각 세션이 dispatch/역할-번호 브랜치의 별도 폴더에서 작업해서 서로 덮어쓰지 않아요.</span>
            </span>
          </label>

          {notices.length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-xl border border-warn/50 bg-warn/5 p-3 text-sm">
              {notices.map(n => <li key={n} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />{n}</li>)}
            </ul>
          )}
          {error && <p className="rounded-xl border border-bad/40 bg-bad/5 p-3 text-sm text-bad" role="alert">{error}</p>}
        </div>

        <DialogFooter className="items-center border-t px-6 py-4 sm:justify-between">
          <p className="num text-sm text-muted-foreground">{total ? `${total}개 세션: ${summary}` : "만들 세션이 없어요"}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>취소</Button>
            <Button onClick={submit} disabled={!total || disconnected || busy}>{busy ? "시작하는 중…" : `세션 ${total}개 시작`}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

