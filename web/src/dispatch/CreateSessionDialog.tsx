// 새 세션 dialog (#587), ported from Dispatch's CreateSessionDialog: a common prompt, then rows of role / model / effort /
// mode / count, each starting from the role's default model. Models are grouped by provider (<optgroup>); a provider
// that is not connected shows 연결 필요 and its models are disabled. Modes a provider cannot run are not offered
// (the server refuses them too). Native modal <dialog>; the browser handles focus, Esc and the inert page.
import { AlertTriangle, Minus, Pencil, Plus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { NativeSelect } from '../components/ui/native-select';
import { Textarea } from '../components/ui/textarea';
import { cn } from '../lib/utils';
import { createBody, disconnected, fitPerm, initialRows, notices, permsFor, providerGroups, rowFor, summary, total, type Row } from './lib/create.ts';
import { permLabel, providerName } from './lib/format.ts';
import { ProviderIcon } from '../ProviderIcon';
import { api, useDispatch } from './store';
import './create-session.css';

const sel = 'h-8 w-full bg-card text-sm';

export function CreateSessionDialog({ folder, onClose, onCreated }: { folder?: string | null; onClose: () => void; onCreated?: (n: number) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const promptId = useId();
  const roles = useDispatch(s => s.roles);
  const models = useDispatch(s => s.models);
  const providers = useDispatch(s => s.providers);
  const perms = useDispatch(s => s.perms);
  const limits = useDispatch(s => s.limits);
  const project = useDispatch(s => s.project);

  const [rows, setRows] = useState<Row[]>(() => initialRows(roles));
  const [prompt, setPrompt] = useState('');
  const [worktree, setWorktree] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  // Roles can arrive after the dialog opened (first snapshot): fill the empty form once.
  useEffect(() => {
    if (roles.length) setRows(rs => (rs.length ? rs : initialRows(roles)));
  }, [roles]);

  const modelOf = (id: string) => models.find(m => m.id === id);
  const update = (key: number, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const count = total(rows);
  const off = disconnected(rows, models, providers);
  const notes = useMemo(() => notices(rows, { models, providers, limits, worktree }), [rows, models, providers, limits, worktree]);
  const groups = providerGroups(models);

  const submit = async () => {
    if (!prompt.trim()) { setError('모든 세션에 보낼 공통 프롬프트를 입력하세요.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ sessions: unknown[] }>('POST', '/api/sessions', createBody(rows, prompt, worktree, folder));
      onCreated?.(res.sessions.length);
      ref.current?.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : '세션을 시작하지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid="create-session-dialog"
      onClose={onClose}
      className="create-session-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(960px,calc(100vw-1rem))] max-w-none rounded-panel border-0 bg-card p-0 text-card-foreground shadow-[0_0_0_1px_var(--border),0_24px_60px_rgb(0_0_0/0.22)]"
    >
      <form
        className="flex max-h-[calc(100dvh-2rem)] flex-col"
        onSubmit={e => { e.preventDefault(); if (!busy) void submit(); }}
      >
        <header className="px-5 pt-5 pb-1">
          <h2 id={titleId} className="text-base font-semibold">새 세션</h2>
          {project.name && <p className="mt-1 truncate text-sm text-muted-foreground"><span className="font-medium text-foreground">{project.name}</span>에서 실행돼요</p>}
        </header>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={promptId} className="text-xs font-medium">공통 프롬프트</label>
            <Textarea id={promptId} autoFocus value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} className="rounded-control border-(--line-strong) bg-card"
              placeholder="예: 결제 모듈의 환불 로직을 정리하고 테스트를 보강해줘." />
            <p className="text-xs text-muted-foreground">모든 세션이 이 메시지로 시작해요. 역할별 지시는 연필 버튼으로 바꿀 수 있어요.</p>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <legend className="text-xs font-medium">세션 구성</legend>
              <Button size="sm" variant="ghost" disabled={!roles.length}
                onClick={() => setRows(rs => [...rs, rowFor(roles[rs.length % roles.length])])}><Plus />역할 추가</Button>
            </div>
            <ul className="flex flex-col gap-2">
              {rows.map(r => {
                const m = modelOf(r.model);
                const roleName = roles.find(x => x.id === r.role)?.name ?? r.role;
                return (
                  <li key={r.key} data-testid="create-session-row" className="rounded-control bg-background shadow-[0_0_0_1px_var(--border)]">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,.9fr)_minmax(0,1.1fr)_auto_auto] items-center gap-2 p-2 max-md:grid-cols-2">
                      <NativeSelect aria-label="역할" className={sel} value={r.role}
                        onChange={e => { const role = roles.find(x => x.id === e.target.value); if (role) update(r.key, { ...rowFor(role, r.n), key: r.key, open: r.open }); }}>
                        {roles.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </NativeSelect>
                      <NativeSelect aria-label="모델" className={sel} value={r.model} start={m && <ProviderIcon provider={m.provider} className="size-3.5" />}
                        onChange={e => { const p = modelOf(e.target.value)?.provider; update(r.key, { model: e.target.value, effort: 'default', perm: fitPerm(r.perm, p, perms) }); }}>
                        {!m && <option value={r.model}>{r.model}</option>}
                        {groups.map(p => {
                          const on = !!providers[p]?.connected;
                          return (
                            <optgroup key={p} label={`${providers[p]?.name ?? providerName(p)}${on ? '' : ' · 연결 필요'}`}>
                              {models.filter(x => x.provider === p).map(x => <option key={x.id} value={x.id} disabled={!on}>{x.label}</option>)}
                            </optgroup>
                          );
                        })}
                      </NativeSelect>
                      <NativeSelect aria-label="생각 수준" className={sel} value={r.effort} onChange={e => update(r.key, { effort: e.target.value })}>
                        <option value="default">기본{m?.defaultEffort ? ` (${m.defaultEffort})` : ''}</option>
                        {m?.efforts.map(x => <option key={x} value={x}>{x}</option>)}
                      </NativeSelect>
                      <NativeSelect aria-label="권한" className={sel} value={r.perm} onChange={e => update(r.key, { perm: e.target.value })}>
                        {permsFor(m?.provider, perms).map(p => <option key={p} value={p}>{permLabel(p)}</option>)}
                      </NativeSelect>
                      <div className="flex h-8 items-center rounded-control border border-(--line-strong) bg-card" role="group" aria-label={`${roleName} 개수`}>
                        <Button size="icon-sm" variant="ghost" aria-label="줄이기" disabled={r.n <= 1} onClick={() => update(r.key, { n: Math.max(1, r.n - 1) })}><Minus /></Button>
                        <output className="w-6 text-center text-sm tabular-nums">{r.n}</output>
                        <Button size="icon-sm" variant="ghost" aria-label="늘리기" disabled={r.n >= 10} onClick={() => update(r.key, { n: Math.min(10, r.n + 1) })}><Plus /></Button>
                      </div>
                      <div className="flex justify-end">
                        <Button size="icon" variant="ghost" aria-label={`${roleName} 역할 프롬프트 편집`} aria-pressed={r.open}
                          className={cn(r.open && 'bg-accent')} onClick={() => update(r.key, { open: !r.open })}><Pencil /></Button>
                        <Button size="icon" variant="ghost" aria-label="이 줄 지우기" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}><X /></Button>
                      </div>
                    </div>
                    {r.open && (
                      <div className="px-2 pb-2">
                        <Textarea value={r.prompt} onChange={e => update(r.key, { prompt: e.target.value })} rows={3} className="rounded-control border-(--line-strong) bg-card"
                          aria-label={`${roleName} 역할 프롬프트`} />
                      </div>
                    )}
                  </li>
                );
              })}
              {rows.length === 0 && <li className="rounded-control border border-dashed p-6 text-center text-sm text-muted-foreground">역할을 하나 이상 추가하세요.</li>}
            </ul>
          </fieldset>

          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={worktree} onChange={e => setWorktree(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span>
              세션마다 git worktree 분리
              <span className="block text-xs text-muted-foreground">세션마다 따로 만든 브랜치 폴더에서 작업해서 서로 덮어쓰지 않아요.</span>
            </span>
          </label>

          {notes.length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-card border border-warn/50 bg-warn/5 p-3 text-sm">
              {notes.map(n => <li key={n} className="flex gap-2"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />{n}</li>)}
            </ul>
          )}
          {error && <p role="alert" className="rounded-card border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 pt-3 pb-5 max-md:flex-col max-md:items-stretch">
          <p className="truncate text-xs text-muted-foreground tabular-nums">{count ? `${count}개 세션: ${summary(rows, models)}` : '만들 세션이 없어요'}</p>
          <div className="flex shrink-0 justify-end gap-2">
            <Button variant="ghost" onClick={() => ref.current?.close()}>취소</Button>
            <Button type="submit" disabled={!count || off || busy}>{busy ? '시작하는 중…' : `세션 ${count}개 시작`}</Button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
