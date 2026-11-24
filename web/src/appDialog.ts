// In-app replacements for window.confirm / prompt / alert (#732). Callers await askConfirm / askText /
// showNotice; <AppDialogHost> (mounted once in App) shows the oldest open request as a native modal <dialog>.
// Requests queue: a second ask while one is open waits its turn instead of replacing it.

export type ConfirmRequest = {
  kind: 'confirm';
  title: string;
  body?: string;
  /** Label of the confirming button (default 확인). */
  ok?: string;
  cancel?: string;
  /** The confirming action deletes or overwrites something: red button, focus starts on 취소. */
  danger?: boolean;
};
export type TextRequest = {
  kind: 'text';
  title: string;
  body?: string;
  /** Accessible name of the field (defaults to the title). */
  label?: string;
  initial?: string;
  placeholder?: string;
  ok?: string;
  cancel?: string;
  /** Return a Korean message to keep the dialog open with that error, or null when the value is fine. */
  validate?: (value: string) => string | null;
};
export type NoticeRequest = { kind: 'notice'; title: string; body?: string; ok?: string };
export type DialogRequest = ConfirmRequest | TextRequest | NoticeRequest;

type Answer<R extends DialogRequest> = R extends ConfirmRequest ? boolean : R extends TextRequest ? string | null : void;
export type OpenDialog = { id: number; request: DialogRequest };
type Entry = OpenDialog & { resolve: (v: unknown) => void };

let queue: Entry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeDialogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The dialog to show now (the oldest unanswered request), or null. Stable between changes (for useSyncExternalStore). */
export function currentDialog(): OpenDialog | null {
  return queue[0] ?? null;
}

function ask<R extends DialogRequest>(request: R): Promise<Answer<R>> {
  return new Promise((resolve) => {
    queue = [...queue, { id: nextId++, request, resolve: resolve as (v: unknown) => void }];
    emit();
  });
}

/**
 * Answer an open request. confirm: true/false; text: the value or null (cancelled); notice: anything.
 * Unknown or already answered ids are ignored, so a late close event cannot answer the next request.
 */
export function settleDialog(id: number, value: unknown): void {
  const entry = queue.find((e) => e.id === id);
  if (!entry) return;
  queue = queue.filter((e) => e !== entry);
  const r = entry.request;
  entry.resolve(r.kind === 'confirm' ? value === true : r.kind === 'text' ? (typeof value === 'string' ? value : null) : undefined);
  emit();
}

export const askConfirm = (o: Omit<ConfirmRequest, 'kind'>) => ask({ kind: 'confirm', ...o });
export const askText = (o: Omit<TextRequest, 'kind'>) => ask({ kind: 'text', ...o });
export const showNotice = (o: Omit<NoticeRequest, 'kind'>) => ask({ kind: 'notice', ...o });

/** Tests only: drop every open request without answering. */
export function resetDialogsForTest(): void {
  queue = [];
  emit();
}
