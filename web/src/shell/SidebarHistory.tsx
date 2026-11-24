// 기록 (#968): the saved chats under 문서 in the sidebar, newest first. A row is the first question's summary and
// its time; it only shows what the server keeps (title, time), never message text.
import { useEffect } from 'react';
import { MessageSquare, MoreHorizontal, Trash2 } from 'lucide-react';
import { askConfirm } from '../appDialog';
import { toastResult } from '../activity/actionToast';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '../components/ui/sidebar';
import { ago, reloadHistory, removeChat, rowTitle, useChatHistory, type ChatSummary } from './chatHistory';
import { openChatSession } from '../chat';

/** 지우기: asks first, then removes the saved file; a failure keeps the row and says so. */
async function confirmRemove(chat: ChatSummary) {
  const ok = await askConfirm({ title: '이 대화를 지울까요?', body: `"${rowTitle(chat)}" 기록이 사라져요. 되돌릴 수 없어요.`, ok: '지우기', danger: true });
  if (!ok) return;
  try {
    await removeChat(chat.id);
    toastResult('대화 기록을 지웠어요.');
  } catch (e) {
    toastResult(e instanceof Error ? e.message : '지우지 못했어요.', true);
    void reloadHistory();
  }
}

function HistoryRow({ chat }: { chat: ChatSummary }) {
  const title = rowTitle(chat);
  return (
    <SidebarMenuItem data-chat-row={chat.id}>
      {/* A chat saved without its CLI session id cannot be resumed: the row stays, greyed. */}
      <SidebarMenuButton
        className="pr-8 font-normal text-muted-foreground hover:text-foreground max-md:pr-12"
        title={chat.sessionId ? title : `${title} (다시 열 수 없어요)`}
        disabled={!chat.sessionId}
        onClick={() => chat.sessionId && openChatSession(chat.sessionId)}
      >
        <MessageSquare className="size-[15px]! text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <time className="shrink-0 text-2xs tabular-nums text-muted-foreground" dateTime={new Date(chat.updatedAt).toISOString()}>
          {ago(chat.updatedAt)}
        </time>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={`${title} 메뉴`} className="right-1">
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onSelect={() => void confirmRemove(chat)}>
            <Trash2 className="size-4" /> 지우기
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

export function SidebarHistory() {
  const { chats, loaded, error } = useChatHistory();
  useEffect(() => void reloadHistory(), []);
  return (
    <SidebarGroup className="mt-3" data-chat-history="">
      <SidebarGroupLabel>기록</SidebarGroupLabel>
      {!loaded ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">불러오는 중이에요…</p>
      ) : error ? (
        <p className="px-2 py-1 text-xs text-destructive" role="status">기록을 불러오지 못했어요.</p>
      ) : chats.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">아직 지난 대화가 없어요. 채팅으로 대화하면 여기에 남아요.</p>
      ) : (
        <SidebarMenu>
          {chats.map((c) => (
            <HistoryRow key={c.id} chat={c} />
          ))}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
}
