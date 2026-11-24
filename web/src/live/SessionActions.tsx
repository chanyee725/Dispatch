// 중단 · 종료 (or 목록에서 지우기) as small icon buttons in the live panel's head (#915). Loaded lazily with the
// panel's first visit to 대화. 종료 and 지우기 ask first.
import { Power, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { askConfirm } from '../appDialog';
import { api, useDispatch } from '../dispatch/store';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';

export default function SessionActions({ sid, onRemoved }: { sid: string; onRemoved: () => void }) {
  const s = useDispatch((st) => st.sessions.find((x) => x.id === sid));
  if (!s) return null;
  const id = encodeURIComponent(s.id);
  const run = (path: string, then?: () => void) => api('POST', `/api/sessions/${id}/${path}`).then(then, (e: Error) => void toast.error(e.message));
  const done = s.status === 'done';
  return (
    <>
      <button type="button" aria-label="중단" title="중단" disabled={s.status !== 'running' && s.status !== 'waiting'} onClick={() => void run('interrupt')}
        className={cn('agent-live-icon', FOCUS_RING)}>
        <Square aria-hidden className="size-4" />
      </button>
      {done ? (
        <button type="button" aria-label="목록에서 지우기" title="목록에서 지우기" className={cn('agent-live-icon', FOCUS_RING)}
          onClick={async () => { if (await askConfirm({ title: '목록에서 지울까요?', body: '이 세션을 보드에서 지워요.', ok: '지우기', danger: true })) void run('remove', onRemoved); }}>
          <Trash2 aria-hidden className="size-4" />
        </button>
      ) : (
        <button type="button" aria-label="종료" title="종료" className={cn('agent-live-icon agent-live-danger', FOCUS_RING)}
          onClick={async () => { if (await askConfirm({ title: '세션을 종료할까요?', body: '실행 중인 작업이 멈춰요.', ok: '종료', danger: true })) void run('kill'); }}>
          <Power aria-hidden className="size-4" />
        </button>
      )}
    </>
  );
}
