// #899: only the results of what the person just did become Sonner toasts; agent and workspace events stay in the 알림함.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toast } from 'sonner';
import { actionToastOf } from '../../web/src/activity/appEvents.ts';
import { registerHooks } from 'node:module';

// The web app imports its own modules without extensions (Vite resolves them); let this test do the same.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (!specifier.startsWith('.')) throw err;
      for (const ext of ['.ts', '.tsx']) {
        try {
          return next(specifier + ext, context);
        } catch {}
      }
      throw err;
    }
  },
});
const { toastAction, toastRequest, toastResult } = await import('../../web/src/activity/actionToast.ts');

test('file actions become toasts with a stable id and a success or error tone', () => {
  assert.deepEqual(actionToastOf({ type: 'saved', path: 'a/설계.dpx.json' }), { id: 'saved:a/설계.dpx.json', category: 'files', tone: 'success', text: '저장했어요' });
  assert.deepEqual(actionToastOf({ type: 'save-failed', path: 'a.dpx.json' }), { id: 'save-failed:a.dpx.json', category: 'files', tone: 'error', text: '저장하지 못했어요' });
  assert.equal(actionToastOf({ type: 'created', kind: 'doc', path: 'a/설계.dpx.json' })?.tone, 'success');
  assert.equal(actionToastOf({ type: 'deleted', kind: 'folder', path: 'a/' })?.tone, 'success');
  assert.equal(actionToastOf({ type: 'moved', kind: 'doc', from: 'a/x.dpx.json', to: 'b/x.dpx.json' })?.category, 'files');
  assert.equal(actionToastOf({ type: 'renamed', kind: 'doc', from: 'a/x.dpx.json', to: 'a/y.dpx.json' })?.category, 'files');
});

test('agent, run and workspace events never become toasts', () => {
  assert.equal(actionToastOf({ type: 'session-started', id: 's1', name: 'Jae', team: false }), null);
  assert.equal(actionToastOf({ type: 'session-asks', id: 's1', name: 'Jae', ask: '어느 쪽으로 할까요?' }), null);
  assert.equal(actionToastOf({ type: 'session-error', id: 's1', name: 'Jae' }), null);
  assert.equal(actionToastOf({ type: 'run-ended', file: 'p.dpx.json', runId: 'r1', failed: true }), null);
  assert.equal(actionToastOf({ type: 'plan-waiting', file: 'p.dpx.json', text: '계획이 기다려요' }), null);
  assert.equal(actionToastOf({ type: 'model-connected', provider: 'claude', name: 'Claude' }), null);
  assert.equal(actionToastOf({ type: 'settings-saved' }), null);
});

test('error toasts stay until closed; success toasts keep the default timeout', async (t) => {
  const error = t.mock.method(toast, 'error', () => 'e');
  const success = t.mock.method(toast, 'success', () => 's');
  const promise = t.mock.method(toast, 'promise', () => undefined);

  toastAction({ type: 'save-failed', path: 'a.dpx.json' });
  toastResult('복사하지 못했어요', true);
  assert.equal(error.mock.callCount(), 2);
  for (const c of error.mock.calls) {
    const opts = c.arguments[1] as { closeButton?: boolean; duration?: number };
    assert.equal(opts.closeButton, true);
    assert.equal(opts.duration, Infinity);
  }

  toastAction({ type: 'saved', path: 'a.dpx.json' });
  toastResult('복사했어요');
  for (const c of success.mock.calls) assert.equal((c.arguments[1] as { duration?: number } | undefined)?.duration, undefined);

  await toastRequest(Promise.resolve(1), { loading: '보내는 중', success: '보냈어요', error: '보내지 못했어요' });
  const data = promise.mock.calls[0].arguments[1] as Record<string, unknown>;
  assert.equal(data.duration, undefined, 'top-level options would also stick to loading and success');
  assert.deepEqual(data.error, { message: '보내지 못했어요', closeButton: true, duration: Infinity });
});
