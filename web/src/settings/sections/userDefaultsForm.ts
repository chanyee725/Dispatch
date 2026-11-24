// The logic of 설정 > 일반 > 기본값 (E555, #724), free of React so node --test can check it. The values live in
// ~/.dispatch/drawing.json (docs/design/user-defaults.md); the server checks every value again.

export type DefaultsValues = { workspace?: string; port?: number; prStatus?: boolean };
export type DefaultsForm = { workspace: string; port: string; prStatus: boolean };
export type DefaultsField = 'workspace' | 'port';
export type DefaultsPatch = { workspace?: string | null; port?: number | null; prStatus?: boolean | null };

export const DEFAULT_PORT = 4330;

/** The form state for saved values: empty text means "not set" (built-in default). */
export function defaultsForm(v: DefaultsValues): DefaultsForm {
  return { workspace: v.workspace ?? '', port: v.port ? String(v.port) : '', prStatus: v.prStatus ?? true };
}

/** Per-field messages for the current input; empty when the form can be saved. */
export function defaultsErrors(f: DefaultsForm): Partial<Record<DefaultsField, string>> {
  const out: Partial<Record<DefaultsField, string>> = {};
  const ws = f.workspace.trim();
  if (ws && !(ws.startsWith('/') || ws === '~' || ws.startsWith('~/'))) out.workspace = '/나 ~/로 시작하는 경로를 넣어 주세요.';
  const port = f.port.trim();
  if (port && !(/^\d+$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535)) out.port = '1024~65535 사이 숫자를 넣어 주세요.';
  return out;
}

/**
 * What 저장 sends: only changed keys; a cleared field sends null (the key leaves the file). PR tracking left at its
 * built-in value (on) is kept as an explicit true only when the file already had a value.
 */
export function defaultsPatch(saved: DefaultsValues, f: DefaultsForm): DefaultsPatch {
  const patch: DefaultsPatch = {};
  const ws = f.workspace.trim();
  if (ws !== (saved.workspace ?? '')) patch.workspace = ws || null;
  const port = f.port.trim() ? Number(f.port.trim()) : null;
  if (port !== (saved.port ?? null)) patch.port = port;
  if (f.prStatus !== (saved.prStatus ?? true)) patch.prStatus = f.prStatus;
  return patch;
}

/** Whether the input differs from the saved values (unsaved edits, valid or not). */
export function defaultsDirty(saved: DefaultsValues, f: DefaultsForm): boolean {
  const s = defaultsForm(saved);
  return s.workspace !== f.workspace.trim() || s.port !== f.port.trim() || s.prStatus !== f.prStatus;
}
