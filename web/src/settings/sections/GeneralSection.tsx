// 설정 > 일반 (#624): the theme, browser notifications (this browser only, work with Dispatch off), the user's
// defaults from ~/.dispatch/drawing.json (UserDefaultsForm, #724) and the answer
// style switch (a team setting, saved through POST /api/settings `team`; read-only with Dispatch off, #620).
import { useId, useState } from 'react';
import { api } from '../../dispatch/store';
import { turnAlertsOff, turnAlertsOn, useAlertStatus } from '../../dispatch/lib/notify';
import { useDispatch } from '../../dispatch/store';
import { cn } from '../../lib/utils';
import { TOAST_CATEGORIES } from '../../activity/appEvents';
import { setCategoryOn, useToastOff } from '../../activity/appNotify';
import { useSettingsLoad } from '../context';
import { ChatHistoryField } from '../ChatHistoryField';
import { LoadNote, OffNote, ThemeField } from '../DispatchOff';
import { SectionFrame } from '../SectionFrame';
import { TEAM_TOGGLES } from '../model';
import { UserDefaultsForm } from './UserDefaultsForm';

const REPLY = TEAM_TOGGLES.find((f) => f.id === 'replyStyle')!;
const ALERT_NOTE = {
  unsupported: '이 브라우저는 알림을 지원하지 않아요.',
  denied: '브라우저에서 알림을 막아 두었어요. 브라우저 사이트 설정에서 허용해 주세요.',
  off: '',
  on: '',
} as const;

export default function GeneralSection() {
  const { load, retry } = useSettingsLoad();
  const alerts = useAlertStatus();
  const toastOff = useToastOff();
  const toastHint = useId();
  const alertsHint = useId();
  const replyHint = useId();
  const offId = useId();
  const saved = useDispatch((s) => s.settings.team.replyStyle) !== false;
  const [pending, setPending] = useState<boolean | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: '' });
  const off = load.kind === 'off';
  const ready = load.kind === 'ok';
  const reply = pending ?? saved;

  // Saved at once, like the theme: one switch needs no 저장 button.
  const setReply = async (v: boolean) => {
    setPending(v);
    setNote({ text: '' });
    try {
      await api('POST', '/api/settings', { team: { replyStyle: v } });
      setNote({ text: '저장했어요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
    } finally {
      setPending(null);
    }
  };

  return (
    <SectionFrame title="일반" hint="알림은 이 브라우저에만, 테마와 기본값은 이 컴퓨터에 저장돼요." testId="settings-section-general">
      <ThemeField />
      <div className="flex flex-col">
        <h4 className="pb-2 text-sm font-medium">브라우저 알림</h4>
        <div className="settings-row">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <label htmlFor="settings-alerts" className="text-sm font-medium">
              세션 알림 받기
            </label>
            <span id={alertsHint} className="text-xs text-muted-foreground">
              {ALERT_NOTE[alerts] || '세션이 답을 기다리거나 멈추거나 한도에 닿으면 알려 줘요. 이 탭이 가려져 있을 때는 아래 알림도 브라우저 알림으로 보내요.'}
            </span>
          </div>
          <input
            id="settings-alerts"
            type="checkbox"
            {...({ switch: '' } as object)}
            aria-describedby={alertsHint}
            checked={alerts === 'on'}
            disabled={alerts === 'unsupported' || alerts === 'denied'}
            onChange={(e) => void (e.target.checked ? turnAlertsOn() : turnAlertsOff())}
          />
        </div>
      </div>
      <fieldset className="flex flex-col" aria-describedby={toastHint} data-testid="settings-toast-categories">
        <legend className="text-sm font-medium">알림 종류</legend>
        <span id={toastHint} className="pt-1 pb-2 text-xs text-muted-foreground">
          꺼 두면 그 종류의 알림은 뜨지 않아요.
        </span>
        {TOAST_CATEGORIES.map((c) => (
          <label key={c.id} className="settings-row py-2.5 text-sm">
            <span className="min-w-0 flex-1">{c.label}</span>
            <input
              type="checkbox"
              {...({ switch: '' } as object)}
              checked={!toastOff.has(c.id)}
              onChange={(e) => setCategoryOn(c.id, e.target.checked)}
              data-toast-category={c.id}
            />
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">답변 스타일</h4>
        <LoadNote load={load} onRetry={retry} />
        {off && <OffNote id={offId} status={load.status} />}
        <div className={cn('settings-row', !ready && 'opacity-60')}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <label htmlFor="settings-reply-style" className="text-sm font-medium">
              {REPLY.label}
            </label>
            <span id={replyHint} className="text-xs text-muted-foreground">
              {REPLY.hint}
            </span>
          </div>
          <input
            id="settings-reply-style"
            type="checkbox"
            {...({ switch: '' } as object)}
            aria-describedby={off ? `${replyHint} ${offId}` : replyHint}
            checked={reply}
            disabled={!ready || pending !== null}
            onChange={(e) => void setReply(e.target.checked)}
          />
        </div>
        <p role="status" className={cn('min-h-4 text-xs', note.bad ? 'text-destructive' : 'text-muted-foreground')}>
          {note.text}
        </p>
      </div>
      <ChatHistoryField />
      <UserDefaultsForm />
    </SectionFrame>
  );
}
