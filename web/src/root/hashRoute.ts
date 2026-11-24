import { boardHash, parseBoardHash, type BoardSection } from '../projectNav';
import { agentFromHash, withAgent } from '../live/store';

// The 세션 보드's address, plus the open agent live view (`&agent=<sid>`, web/src/live/store.ts).
// A new history entry when it changes, so back/forward walk the board's tabs and scope.
export const setBoardHash = (b: BoardSection, replace = false) => {
  const url = `${window.location.pathname}${window.location.search}${withAgent(boardHash(b), agentFromHash(window.location.hash))}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) return;
  if (replace) window.history.replaceState({ drawing: 1 }, '', url);
  else window.history.pushState({ drawing: 1 }, '', url);
};
/** The board route of the address this page opened with, if any. */
export const initialBoard = () => parseBoardHash(window.location.hash);
