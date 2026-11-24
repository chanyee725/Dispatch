// 설정 > 일반: 대화 기록 모두 지우기 (#968). Removes every saved chat under .atelier/chat/ after one confirmation.
import { useId, useState } from 'react';
import { askConfirm } from '../appDialog';
import { toastResult } from '../activity/actionToast';
import { Button } from '../components/ui/button';
import { clearChats } from '../shell/chatHistory';

export function ChatHistoryField() {
  const hint = useId();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const ok = await askConfirm({ title: '대화 기록을 모두 지울까요?', body: '사이드바 기록에 있는 지난 대화가 전부 사라져요. 되돌릴 수 없어요.', ok: '모두 지우기', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      const n = await clearChats();
      toastResult(n ? `대화 기록 ${n}개를 지웠어요.` : '지울 기록이 없어요.');
    } catch (e) {
      toastResult(e instanceof Error ? e.message : '지우지 못했어요.', true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col" data-testid="settings-chat-history">
      <h4 className="pb-2 text-sm font-medium">대화 기록</h4>
      <div className="settings-row">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">대화 기록 모두 지우기</span>
          <span id={hint} className="text-xs text-muted-foreground">채팅에서 나눈 지난 대화를 이 프로젝트에서 지워요.</span>
        </div>
        <Button type="button" variant="outline" size="sm" aria-describedby={hint} disabled={busy} onClick={() => void run()}>
          모두 지우기
        </Button>
      </div>
    </div>
  );
}
