// 설정 > 모드별 모델 (#748; was 역할별 모델, #624): one tab per mode (계획/설계 … 조사), and in each a row per role with
// its model, effort, permission mode and the model's 잘하는 것 hint. Reads and saves GET/PUT /api/mode-profiles; only
// changed cells and hints are sent, in one 저장 for every mode. A cell shows the user's choice, else the built-in
// default; when a team started now would get another model (provider not connected, model gone), the server's note
// says which and why. With Dispatch off it shows read-only with the reason (#620). Spec: docs/design/mode-profiles.md.
// The section id stays `roles` so the dirty mark and close-confirm keep working.
import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { NativeSelect } from '../../components/ui/native-select';
import { fitPerm, permsFor } from '../../dispatch/lib/create';
import { permLabel } from '../../dispatch/lib/format';
import { api, useDispatch } from '../../dispatch/store';
import { events } from '../../lib/events';
import { cn } from '../../lib/utils';
import { ProviderIcon } from '../../ProviderIcon';
import { useModels } from '../../SidebarModels';
import { useDirtyMark, useSectionShown, useSettingsLoad } from '../context';
import { LoadNote, OffNote } from '../DispatchOff';
import { PRIMARY_BTN } from '../LimitsForm';
import { SectionFrame } from '../SectionFrame';
import { modelGroups, providerName, roleChoice } from './modelsSection';
import {
  HINT_MAX,
  dirtyNote,
  fallbackNote,
  hintKey,
  modePatch,
  rowChanged,
  saveBody,
  shownCell,
  type Cell,
  type Edits,
  type ModeProfiles,
} from './modeProfiles';

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
const CONTROL = cn('h-8 w-full min-w-0 bg-card text-sm max-md:h-11 aria-invalid:border-warn', FOCUS);
const SECONDARY_BTN = cn('press h-8 rounded-control bg-card px-3 text-sm shadow-(--shadow-card) hover:bg-accent disabled:opacity-50 max-md:h-11', FOCUS);
const DEFAULT_MODE = 'impl';

const MODE_TEXT: Record<string, string> = {
  plan: '큰 그림과 설계를 잡는 모드예요.',
  impl: '기능을 만들고 고치는 기본 모드예요.',
  review: '만든 것을 다른 눈으로 확인하는 모드예요.',
  docs: '문서를 쓰고 다듬는 모드예요. 다음 할 일이 먼저 보이게 짧게 써요.',
  quickfix: '작은 수정을 빨리 끝내는 모드예요.',
  research: '웹 서치와 자료 모으기에 맞춘 모드예요.',
};

export default function RolesSection() {
  const { load, retry } = useSettingsLoad();
  const shownSection = useSectionShown();
  const offId = useId();
  const uid = useId();
  const { providers } = useModels();
  const list = useDispatch((s) => s.models);
  const perms = useDispatch((s) => s.perms);
  const [data, setData] = useState<ModeProfiles | null>(null);
  const [mode, setMode] = useState(DEFAULT_MODE);
  const [edits, setEdits] = useState<Edits>({});
  const [resets, setResets] = useState<ReadonlySet<string>>(new Set());
  const [hintEdits, setHintEdits] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: '' });
  const [saving, setSaving] = useState(false);
  const off = load.kind === 'off';
  const ready = load.kind === 'ok';

  // Read when shown and Dispatch is on; again when providers or models change (what resolves where changes too).
  // Local edits stay; they are kept against the new stored values.
  const connected = Object.entries(providers).map(([id, p]) => `${id}:${p?.connected ? 1 : 0}`).join(',');
  const listKey = list.map((m) => m.id).join(',');
  const fetchProfiles = useCallback(() => {
    api<ModeProfiles>('GET', '/api/mode-profiles').then(setData, () => {});
  }, []);
  useEffect(() => {
    if (ready && shownSection) fetchProfiles();
  }, [ready, shownSection, connected, listKey, fetchProfiles]);
  // Saved from another tab or by a lead: the server broadcasts the new grid.
  useEffect(() => events.subscribeJson<ModeProfiles>('mode-profiles', setData), []);

  const groups = useMemo(() => modelGroups(list, providers), [list, providers]);
  const body = data ? saveBody(data, edits, resets, hintEdits) : null;
  useDirtyMark('roles', body !== null);

  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    // Keep the chosen tab visible in the one-row, sideways-scrolling tab list (only the list scrolls, not the page).
    tabRefs.current.get(mode)?.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' } as ScrollIntoViewOptions);
  }, [mode]);

  const label = (id: string) => list.find((m) => m.id === id)?.label;
  const modeName = (id: string) => data?.modes.find((m) => m.id === id)?.name ?? id;

  const setCell = (role: string, c: Cell) => {
    setEdits((e) => ({ ...e, [mode]: { ...e[mode], [role]: c } }));
    setNote({ text: '' });
  };

  const reset = () => {
    setEdits((e) => {
      const { [mode]: _, ...rest } = e;
      return rest;
    });
    setResets((r) => new Set(r).add(mode));
    setNote({ text: `${modeName(mode)} 모드를 기본값으로 돌렸어요. 저장하면 적용돼요.` });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body) return setNote({ text: '바뀐 게 없어요.' });
    setSaving(true);
    try {
      setData(await api<ModeProfiles>('PUT', '/api/mode-profiles', body));
      setEdits({});
      setResets(new Set());
      setHintEdits({});
      setNote({ text: '저장했어요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
    } finally {
      setSaving(false);
    }
  };

  const status = note.text || (data ? dirtyNote(data, edits, resets, mode) : '');
  const hintNoteId = `${uid}-hint-note`;
  const colModel = `${uid}-col-model`;
  const colEffort = `${uid}-col-effort`;
  const colPerm = `${uid}-col-perm`;

  return (
    <SectionFrame title="모드별 모델" hint="팀이나 플랜 단계를 시작할 때 고른 모드의 설정을 써요. 연결한 제공사의 모델이면 어느 것이든 고를 수 있어요." testId="settings-section-roles">
      <LoadNote load={load} onRetry={retry} />
      {off && <OffNote id={offId} status={load.status} />}
      {off && <p className="text-xs text-muted-foreground">실행 기능이 켜지면 모드별 모델이 보여요.</p>}
      {data && (
        <form noValidate onSubmit={(e) => void submit(e)} aria-label="모드별 모델" data-testid="settings-mode-profiles" className="flex flex-col gap-3">
          <fieldset disabled={!ready} aria-describedby={off ? offId : undefined} className="min-w-0 disabled:opacity-60">
            <legend className="sr-only">모드별 모델</legend>
            <Tabs value={mode} onValueChange={setMode} className="gap-3">
              <TabsList aria-label="모드" className="max-w-full justify-start self-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {data.modes.map((m) => {
                  const dirty = !!modePatch(data, edits, resets, m.id);
                  return (
                    <TabsTrigger
                      key={m.id}
                      value={m.id}
                      ref={(el) => {
                        if (el) tabRefs.current.set(m.id, el);
                        else tabRefs.current.delete(m.id);
                      }}
                      data-mode={m.id}
                      className="flex-none"
                    >
                      {m.name}
                      {dirty && (
                        <>
                          <span aria-hidden className="size-1.5 rounded-full bg-current" />
                          <span className="sr-only">(바뀜)</span>
                        </>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              {data.modes.map((m) => (
                <TabsContent key={m.id} value={m.id} className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                    <p>{MODE_TEXT[m.id] ?? ''}</p>
                    <p id={hintNoteId}>잘하는 것은 모델마다 하나예요. 고치면 그 모델의 모든 칸에 같이 바뀌어요.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-y-4 md:grid-cols-[4.5rem_minmax(0,1fr)_6rem_9.5rem] md:items-center md:gap-x-2 md:gap-y-1">
                    <span aria-hidden className="hidden md:block" />
                    <span id={colModel} className="hidden text-xs text-muted-foreground md:block">
                      모델
                    </span>
                    <span id={colEffort} className="hidden text-xs text-muted-foreground md:block">
                      생각 수준
                    </span>
                    <span id={colPerm} className="hidden text-xs text-muted-foreground md:block">
                      권한
                    </span>
                    {data.roles.map((r) => {
                      const cell = shownCell(data, edits, resets, m.id, r.id);
                      const changed = rowChanged(data, edits, resets, m.id, r.id);
                      const model = list.find((x) => x.id === cell.model);
                      const base = `settings-mode-${m.id}-${r.id}`;
                      const legendId = `${base}-legend`;
                      const warnId = `${base}-warn`;
                      // The server's note describes what is stored; for a changed row, check the pick here.
                      const resolved = data.grid[m.id]?.[r.id]?.resolved;
                      const local = changed && cell.model ? roleChoice(cell.model, list, providers).warn : null;
                      const fb = changed ? (local ? { model: null, text: local, info: false } : null) : fallbackNote(resolved?.note, label);
                      const warn = !!fb && !fb.info;
                      const key = hintKey(cell.provider, cell.model);
                      const hint = hintEdits[key] ?? data.hints[key] ?? '';
                      const custom = hintEdits[key] !== undefined ? hint.trim() !== '' && hint.trim() !== (data.hints[key] ?? '') : data.stored.hints?.[key] !== undefined;
                      const efforts = model?.efforts ?? [];
                      const permOpts = permsFor(cell.provider, perms.length ? perms : ['manual', 'acceptEdits', 'auto', 'plan']);
                      const noModel = !cell.model;
                      return (
                        <fieldset key={r.id} data-role={r.id} className="grid min-w-0 grid-cols-2 gap-x-2 gap-y-1 md:contents">
                          <legend id={legendId} className="sr-only">
                            {r.name}
                          </legend>
                          <label htmlFor={`${base}-model`} className="col-span-2 text-sm font-medium md:col-span-1 md:col-start-1">
                            {r.name}
                          </label>
                          <div className="col-span-2 grid min-w-0 md:col-span-1 md:col-start-2">
                            <NativeSelect
                              id={`${base}-model`}
                              start={<ProviderIcon provider={cell.provider} className="size-4" />}
                              value={cell.model ?? ''}
                              aria-invalid={warn || undefined}
                              aria-describedby={fb ? warnId : undefined}
                              onChange={(e) => {
                                const next = list.find((x) => x.id === e.target.value);
                                if (!next) return;
                                setCell(r.id, { provider: next.provider, model: next.id, effort: null, perm: fitPerm(cell.perm, next.provider, perms) });
                              }}
                              className={CONTROL}
                            >
                              {noModel && <option value="">{`${providerName(cell.provider, providers)} 기본 모델`}</option>}
                              {!noModel && !model && <option value={cell.model!}>{cell.model}</option>}
                              {/* An unconnected provider's models stay visible but cannot be picked (#676). */}
                              {groups.map((g) => (
                                <optgroup key={g.provider} label={g.off ? `${g.name} · ${g.off}` : g.name} disabled={!!g.off}>
                                  {g.models.length === 0 && <option disabled value={`-${g.provider}`}>{g.off ? '연결하면 모델이 보여요' : '모델이 없어요'}</option>}
                                  {g.models.map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </NativeSelect>
                          </div>
                          <div className="flex min-w-0 flex-col gap-1 md:col-start-3">
                            <label htmlFor={`${base}-effort`} className="text-xs text-muted-foreground md:hidden">
                              생각 수준
                            </label>
                            <NativeSelect
                              id={`${base}-effort`}
                              aria-labelledby={`${colEffort} ${legendId}`}
                              value={cell.effort ?? ''}
                              disabled={noModel}
                              onChange={(e) => setCell(r.id, { ...cell, effort: e.target.value || null })}
                              className={CONTROL}
                            >
                              <option value="">기본</option>
                              {cell.effort && !efforts.includes(cell.effort) && <option value={cell.effort}>{cell.effort}</option>}
                              {efforts.map((x) => (
                                <option key={x} value={x}>
                                  {x}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                          <div className="flex min-w-0 flex-col gap-1 md:col-start-4">
                            <label htmlFor={`${base}-perm`} className="text-xs text-muted-foreground md:hidden">
                              권한
                            </label>
                            <NativeSelect
                              id={`${base}-perm`}
                              aria-labelledby={`${colPerm} ${legendId}`}
                              value={cell.perm}
                              disabled={noModel}
                              onChange={(e) => setCell(r.id, { ...cell, perm: e.target.value })}
                              className={CONTROL}
                            >
                              {!permOpts.includes(cell.perm) && <option value={cell.perm}>{permLabel(cell.perm)}</option>}
                              {permOpts.map((p) => (
                                <option key={p} value={p}>
                                  {permLabel(p)}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                          {fb && (
                            <p
                              id={warnId}
                              data-testid="settings-mode-fallback"
                              className={cn('col-span-2 text-xs md:col-span-3 md:col-start-2', warn ? 'text-warn' : 'text-muted-foreground')}
                            >
                              <TriangleAlert aria-hidden className="mr-1 inline size-3 -translate-y-px align-middle" strokeWidth={2.25} />
                              {fb.model ? (
                                <>
                                  대신 <strong className="font-semibold">{fb.model}</strong>: {fb.text}
                                </>
                              ) : (
                                fb.text
                              )}
                            </p>
                          )}
                          <div className="col-span-2 flex min-w-0 items-center gap-2 md:col-span-3 md:col-start-2 md:mb-2.5">
                            <label htmlFor={`${base}-hint`} className="shrink-0 text-xs text-muted-foreground">
                              잘하는 것
                            </label>
                            <input
                              id={`${base}-hint`}
                              type="text"
                              maxLength={HINT_MAX}
                              value={hint}
                              disabled={noModel && cell.provider === 'claude'}
                              aria-describedby={hintNoteId}
                              onChange={(e) => {
                                const v = e.target.value;
                                setHintEdits((h) => ({ ...h, [key]: v }));
                                setNote({ text: '' });
                              }}
                              className={cn('h-8 min-w-0 flex-1 rounded-control border border-(--line-strong) bg-card px-2 text-sm max-md:h-11', FOCUS)}
                            />
                            {custom && <span className="shrink-0 rounded-full bg-(--sunken) px-2 text-2xs text-muted-foreground">직접 씀</span>}
                          </div>
                        </fieldset>
                      );
                    })}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </fieldset>
          {ready && (
            // Sticky to the body's bottom edge, over its bottom padding, so rows never show below it.
            <div className="sticky bottom-[calc(var(--overlay-end)*-1)] z-10 -mb-[var(--overlay-end)] flex items-center justify-end gap-2 border-t bg-card pt-3 pb-[var(--overlay-end)]">
              <p role="status" className={cn('mr-auto min-h-4 text-xs', note.bad ? 'text-destructive' : 'text-muted-foreground')}>
                {status}
              </p>
              <button
                type="button"
                onClick={reset}
                disabled={saving || (!data.stored.cells?.[mode] && !edits[mode]) || (resets.has(mode) && !edits[mode])}
                className={SECONDARY_BTN}
              >
                이 모드 기본값으로
              </button>
              <button type="submit" disabled={saving} className={PRIMARY_BTN}>
                저장
              </button>
            </div>
          )}
        </form>
      )}
    </SectionFrame>
  );
}

