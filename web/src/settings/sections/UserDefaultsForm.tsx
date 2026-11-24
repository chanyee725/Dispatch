// 설정 > 일반 > 기본값 (E555, #724): default workspace folder, default port and the PR tracking default, saved to
// ~/.dispatch/drawing.json through /api/user-defaults. A broken file shows its error and the form stays read-only
// (the server never overwrites it). Metadata only: paths, a port and a switch.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, type UserDefaultsStatus } from '../../api';
import { cn } from '../../lib/utils';
import { useDirtyMark } from '../context';
import { BTN, PRIMARY_BTN } from '../LimitsForm';
import { DEFAULT_PORT, defaultsDirty, defaultsErrors, defaultsForm, defaultsPatch, type DefaultsField, type DefaultsForm } from './userDefaultsForm';

const INPUT = 'h-8 rounded-control border border-(--line-strong) bg-card px-2 text-sm aria-invalid:border-destructive max-md:h-11';

export function UserDefaultsForm() {
  const [status, setStatus] = useState<UserDefaultsStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<DefaultsForm>(() => defaultsForm({}));
  const [errors, setErrors] = useState<Partial<Record<DefaultsField, string>>>({});
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: '' });
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const ids = { ws: `${uid}-ws`, port: `${uid}-port`, pr: `${uid}-pr`, broken: `${uid}-broken` };

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await api.userDefaults();
      setStatus(s);
      setForm(defaultsForm(s.values));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '불러오지 못했어요.');
    }
  }, []);
  useEffect(() => void load(), [load]);

  const saved = status?.values ?? {};
  useDirtyMark('user-defaults', status ? defaultsDirty(saved, form) : false);
  const broken = !!status?.error;
  const noFile = status !== null && status.file === null;
  const readOnly = !status || broken || noFile;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    const errs = defaultsErrors(form);
    setErrors(errs);
    const first = (['workspace', 'port'] as const).find((k) => errs[k]);
    if (first) {
      // Focus the first bad field so its message is read out with it.
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return setNote({ text: '고칠 값이 있어요.', bad: true });
    }
    const patch = defaultsPatch(saved, form);
    if (!Object.keys(patch).length) return setNote({ text: '바뀐 게 없어요.' });
    setSaving(true);
    try {
      const s = await api.setUserDefaults(patch);
      setStatus(s);
      setForm(defaultsForm(s.values));
      setNote({ text: '저장했어요. 작업 폴더와 포트는 다음에 npm start 할 때 써요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
      // A 409 means the file broke since it was read: show that state.
      void api.userDefaults().then(setStatus, () => {});
    } finally {
      setSaving(false);
    }
  };

  const setText = (k: DefaultsField, v: string) => {
    const next = { ...form, [k]: v };
    setForm(next);
    // Clear a message as soon as the field is fixed; new ones only show on 저장.
    if (errors[k] && !defaultsErrors(next)[k]) setErrors((x) => ({ ...x, [k]: undefined }));
    setNote({ text: '' });
  };

  // The error id joins aria-describedby only while the error shows, so nothing is read out before 저장.
  const described = (id: string, k: DefaultsField) => (errors[k] ? `${id}-hint ${id}-error` : `${id}-hint`);

  return (
    <div className="flex flex-col gap-2" data-testid="settings-user-defaults">
      <h4 className="text-sm font-medium">기본값</h4>
      <span className="text-xs text-muted-foreground">
        이 컴퓨터의 <code>~/.dispatch/drawing.json</code>에 저장돼요. 직접 고쳐도 돼요.
      </span>
      {loadError && (
        <p role="alert" className="text-xs text-destructive">
          기본값을 불러오지 못했어요. {loadError}{' '}
          <button type="button" onClick={() => void load()} className="underline">
            다시 시도
          </button>
        </p>
      )}
      {broken && (
        <div id={ids.broken} role="alert" data-testid="settings-user-defaults-broken" className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          {status!.error}
        </div>
      )}
      {noFile && <p className="text-xs text-muted-foreground">이 서버는 기본값 파일을 쓰지 않아요.</p>}
      {!broken && status && status.problems.length > 0 && (
        <p className="text-xs text-muted-foreground">파일에서 잘못된 값은 건너뛰었어요: {status.problems.join(', ')}</p>
      )}
      {status && (
        <form ref={formRef} noValidate onSubmit={(e) => void submit(e)} aria-label="기본값" className="flex flex-col gap-3">
          <fieldset disabled={readOnly} aria-describedby={broken ? ids.broken : undefined} className="flex min-w-0 flex-col gap-3 disabled:opacity-60">
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.ws} className="text-xs text-muted-foreground">
                기본 작업 폴더
              </label>
              <input
                id={ids.ws}
                name="workspace"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="~/docs/drawing"
                aria-invalid={errors.workspace ? true : false}
                aria-describedby={described(ids.ws, 'workspace')}
                value={form.workspace}
                onChange={(e) => setText('workspace', e.target.value)}
                className={cn(INPUT, 'w-full max-w-sm font-mono')}
              />
              <span id={`${ids.ws}-hint`} className="text-xs text-muted-foreground">
                npm start에 폴더를 안 주면 이 폴더로 열어요. 비워 두면 npm start에 폴더를 직접 줘야 해요.
              </span>
              {errors.workspace && (
                <span id={`${ids.ws}-error`} className="text-xs text-destructive">
                  {errors.workspace}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.port} className="text-xs text-muted-foreground">
                기본 포트 · 기본값 {DEFAULT_PORT}
              </label>
              <input
                id={ids.port}
                name="port"
                type="number"
                inputMode="numeric"
                min={1024}
                max={65535}
                step={1}
                placeholder={String(DEFAULT_PORT)}
                aria-invalid={errors.port ? true : false}
                aria-describedby={described(ids.port, 'port')}
                value={form.port}
                onChange={(e) => setText('port', e.target.value)}
                className={cn(INPUT, 'w-28 tabular-nums')}
              />
              <span id={`${ids.port}-hint`} className="text-xs text-muted-foreground">
                1024~65535 사이. DRAW_PORT를 주면 그게 먼저예요.
              </span>
              {errors.port && (
                <span id={`${ids.port}-error`} className="text-xs text-destructive">
                  {errors.port}
                </span>
              )}
            </div>
            <div className="settings-row">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <label htmlFor={ids.pr} className="text-sm font-medium">
                  PR 추적 기본으로 켜기
                </label>
                <span id={`${ids.pr}-hint`} className="text-xs text-muted-foreground">
                  작업 폴더에서 따로 켜고 끈 값이 있으면 그 값이 먼저예요. 기본값 켜짐.
                </span>
              </div>
              <input
                id={ids.pr}
                name="prStatus"
                type="checkbox"
                {...({ switch: '' } as object)}
                aria-describedby={`${ids.pr}-hint`}
                checked={form.prStatus}
                onChange={(e) => {
                  setForm((f) => ({ ...f, prStatus: e.target.checked }));
                  setNote({ text: '' });
                }}
              />
            </div>
          </fieldset>
          {!readOnly && (
            <>
              <p role="status" className={cn('min-h-4 text-xs', note.bad ? 'text-destructive' : 'text-muted-foreground')}>
                {note.text}
              </p>
              <div className="flex justify-end">
                <button type="submit" disabled={saving} className={PRIMARY_BTN}>
                  저장
                </button>
              </div>
            </>
          )}
          {readOnly && broken && (
            <div className="flex justify-end">
              <button type="button" onClick={() => void load()} className={cn(BTN, 'bg-card shadow-(--shadow-card)')}>
                다시 읽기
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
