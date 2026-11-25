// Public entry of the chat (#968): reopen a saved conversation from anywhere (the sidebar history, s3).
// The dock listens for the window event, so this works whether or not the dock has rendered its window yet.
import { OPEN_CHAT_SESSION } from '../shell/chatHistory.ts';

/** Opens the chat on the conversation of `cliSessionId` (a saved CLI session id): the live helper or a resumed one. */
export function openChatSession(cliSessionId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_SESSION, { detail: { cliSessionId } }));
}
