// Usage-limit and session-length guard form (E509c), in the 설정 modal's 사용 한도 section (#624). Values are
// saved through POST /api/settings; the server keeps them in range, and the guards cannot be switched off here
// (every field has a minimum above 0). Only changed fields are sent (#552). With Dispatch off the fields still show,
// read-only with their defaults and one line saying why (#620).
import { useId, useMemo, useState, type FormEvent } from 'react';
import { api, type DispatchSettings } from '../api';
import { useDispatch } from '../dispatch/store';
import { cn } from '../lib/utils';
import { GUARD_FIELDS, changedValues, guardDirty, fableFollows, guardPatch, guardValue, readGuardTexts, resyncGuardTexts, type GuardField, type GuardSaved, type GuardValues, type SettingsLoad } from './model';
import { useDirtyMark } from './context';
import { LoadNote, OffNote } from './DispatchOff';
import './limits.css';

const ALL = GUARD_FIELDS.flatMap((g) => g.fields);
type Texts = Record<GuardField['id'], string>;
const toTexts = (s: DispatchSettings): Texts => Object.fromEntries(ALL.map((f) => [f.id, String(guardValue(f.id, s))])) as Texts;
const defaults = (): Texts => Object.fromEntries(ALL.map((f) => [f.id, String(f.def)])) as Texts;
const toSaved = (s: DispatchSettings): GuardSaved => ({
  values: Object.fromEntries(ALL.map((f) => [f.id, guardValue(f.id, s)])) as GuardValues,
  fableFollows: fableFollows(s),
});

/** Hover only on enabled buttons, ~120ms, none under prefers-reduced-motion. */
export const BTN = 'press h-8 rounded-control px-3 text-sm outline-none enabled:hover:bg-accent enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:h-11';
export const PRIMARY_BTN = cn(BTN, 'bg-primary text-primary-foreground enabled:hover:bg-primary/90 enabled:hover:text-primary-foreground disabled:opacity-50');

/**
 * The guard form, in the 설정 modal's 사용 한도 section. Values come from the session stream store (the modal holds
 * the stream open), so there is no request of its own (#625); `load` says whether they are in, off or failed.
 * Saved values that change elsewhere (another tab, the server's settings event) follow in fields not edited (#575).
 */
export function LimitsForm({ load, onRetry, labelledBy, className }: { load: SettingsLoad; onRetry: () => void; labelledBy?: string; className?: string }) {
  const settings = useDispatch((s) => s.settings) as unknown as DispatchSettings;
  const providers = useDispatch((s) => s.providers);
  const fromStore = useMemo(() => toSaved(settings), [settings]);
  const [texts, setTexts] = useState<Texts>(() => toTexts(settings));
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: '' });
  const [saving, setSaving] = useState(false);
  // What was last loaded or saved, and whether Fable follows the weekly value; only changes are sent (#552).
  const [saved, setSaved] = useState<GuardSaved>(fromStore);
  const [follows, setFollows] = useState(() => fableFollows(settings));
  // Adjusted during render, as React suggests for state derived from changing props.
  const [seen, setSeen] = useState(fromStore);
  if (seen !== fromStore) {
    setSeen(fromStore);
    setTexts((t) => resyncGuardTexts(saved, fromStore, t, follows));
    if (follows === saved.fableFollows) setFollows(fromStore.fableFollows);
    setSaved(fromStore);
  }
  // In every load state: a dropped or reconnecting stream keeps the input on screen (#644).
  useDirtyMark('limits', guardDirty(saved, texts, follows));

  // While Fable follows the weekly value its field mirrors 주간 한도; typing in it gives Fable its own value, and
  // clearing it makes it follow again (#563).
  const set = (id: GuardField['id'], v: string) => {
    setTexts((t) => ({ ...t, [id]: v, ...(id === 'seven' && follows && t.fable.trim() ? { fable: v } : {}) }));
    if (id === 'fable') setFollows(!v.trim());
    setNote({ text: '' });
  };
  const followWeekly = (t: Texts): Texts => ({ ...t, fable: t.seven });
  const resetAll = () => {
    setTexts(followWeekly(defaults()));
    setFollows(true);
    setNote({ text: '' });
  };
  const resetOne = (f: GuardField) => {
    if (f.id !== 'fable') return set(f.id, String(f.def));
    setTexts(followWeekly);
    setFollows(true);
    setNote({ text: '' });
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (load.kind !== 'ok') return;
    const read = readGuardTexts(texts, follows);
    if ('error' in read) return setNote({ text: read.error, bad: true });
    setSaving(true);
    try {
      const next = await api.saveDispatchSettings(guardPatch(changedValues(saved, read.values, read.follows)));
      setTexts(toTexts(next));
      setSaved(toSaved(next));
      setFollows(fableFollows(next));
      setNote({ text: '저장했어요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
    } finally {
      setSaving(false);
    }
  };

  const offId = useId();
  const off = load.kind === 'off';
  return (
    <form onSubmit={(e) => void submit(e)} aria-labelledby={labelledBy} data-testid="limits-form" className={cn('limits-form flex flex-col gap-4', className)}>
      {(load.kind === 'loading' || load.kind === 'failed') && <LoadNote load={load} onRetry={onRetry} />}
      {off && <OffNote id={offId} status={load.status} />}
      {(load.kind === 'ok' || off) &&
        // A provider's group shows once that provider is connected (#676); with Dispatch off every group shows read-only.
        GUARD_FIELDS.filter((g) => !g.provider || off || (providers as Record<string, { connected?: boolean } | undefined>)[g.provider]?.connected).map((g) => (
          <fieldset key={g.title} disabled={off} aria-describedby={off ? offId : undefined} data-provider={g.provider} className="flex min-w-0 flex-col gap-2 rounded-card bg-background px-4 py-3.5 disabled:opacity-60">
            {/* A legend inside a padded fieldset sits on its border; float it so it stays in the card (#889). */}
            <legend className="float-left w-full text-sm font-medium">{g.title}</legend>
            <p className="text-xs text-muted-foreground">{g.hint}</p>
            {g.fields.length > 0 && <ul className="flex flex-col gap-2">
              {g.fields.map((f) => (
                <li key={f.id} className="flex flex-wrap items-end gap-x-3 gap-y-1">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <label htmlFor={`limit-${f.id}`} className="text-xs text-muted-foreground">
                      {f.label} ({f.unit}) · {f.id === 'fable' ? (follows ? '비워 두면 주간 한도를 따라요' : '따로 정했어요 · 비우면 주간 한도를 따라요') : `기본값 ${f.def}`}
                    </label>
                    <input
                      id={`limit-${f.id}`}
                      name={f.id}
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={f.min}
                      max={f.max}
                      required={f.id !== 'fable'}
                      value={texts[f.id]}
                      onChange={(e) => set(f.id, e.target.value)}
                      className="h-8 w-28 rounded-control border border-(--line-strong) bg-card px-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`${f.label} 기본값으로`}
                    disabled={f.id === 'fable' ? follows : texts[f.id] === String(f.def)}
                    onClick={() => resetOne(f)}
                    className={cn(BTN, 'text-muted-foreground disabled:opacity-50')}
                  >
                    기본값으로
                  </button>
                  <span className="basis-full text-xs text-muted-foreground">
                    {f.min}~{f.max} 사이
                  </span>
                </li>
              ))}
            </ul>}
          </fieldset>
        ))}
      <p role="status" className={cn('min-h-4 text-xs', note.bad ? 'text-destructive' : 'text-muted-foreground')}>
        {note.text}
      </p>
      {load.kind === 'ok' && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={resetAll} className={cn(BTN, 'bg-card shadow-(--shadow-card)')}>
            모두 기본값으로
          </button>
          <button type="submit" disabled={saving} className={PRIMARY_BTN}>
            저장
          </button>
        </div>
      )}
    </form>
  );
}
