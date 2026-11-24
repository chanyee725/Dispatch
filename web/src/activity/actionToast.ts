// Toasts for the result of what the person just did (#899): 저장, 만들기·지우기·옮기기, 허용/거절, 시작하기, 복사.
// The one toast system (Sonner; <Toaster /> in components/ui/sonner.tsx). Agent and workspace events never pop up:
// they only go out as browser notifications (appNotify.ts). Texts are short metadata only — never a transcript, a question or a name.
import { toast } from 'sonner';
import { actionToastOf, type AppEvent } from './appEvents';
import { categoryOn } from './appNotify';

/** A file action's result (category switches in 설정 > 일반 > 알림 still apply). */
export function toastAction(e: AppEvent) {
  const t = actionToastOf(e);
  if (!t || !categoryOn(t.category)) return;
  if (t.tone === 'error') toast.error(t.text, { id: t.id, closeButton: true, duration: Infinity });
  else toast.success(t.text, { id: t.id });
}

/** A one-line result the person asked for (복사했어요, 내보냈어요); a failure stays until closed. */
export function toastResult(text: string, failed = false) {
  if (failed) toast.error(text, { closeButton: true, duration: Infinity });
  else toast.success(text);
}

/**
 * An approval sent to the server (허용/거절, 시작하기): loading while it goes, then the result. `error` null leaves the
 * failure to the caller's inline message (the toast just closes). Returns the request's own promise.
 */
export function toastRequest<T>(request: Promise<T>, text: { loading: string; success: string; error: string | null }): Promise<T> {
  toast.promise(request, {
    loading: text.loading,
    success: text.success,
    // Options inside `error` apply to the failure only; top-level ones would also stick to loading and success.
    ...(text.error ? { error: { message: text.error, closeButton: true, duration: Infinity } } : {}),
  });
  return request;
}
