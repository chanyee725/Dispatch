import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { openChat } from '../chat';
import { isChatHash, parseBoardHash, type BoardExtra, type Section } from '../projectNav';
import { setBoardHash } from './hashRoute';

type HashNavigation = {
  setSection: Dispatch<SetStateAction<Section>>;
  setBoardExtra: (extra: BoardExtra) => void;
};

/** Follows the address: `#board…` shows that board view, `#chat` opens the chat dock; anything else (an old `#file=`) is the board. */
export function useHashNavigation({ setSection, setBoardExtra }: HashNavigation) {
  useEffect(() => {
    const follow = (first: boolean) => {
      const hash = window.location.hash;
      const board = parseBoardHash(hash);
      if (board) {
        setSection({ kind: 'board', tab: board.tab, folder: board.folder });
        if (board.extra && !first) setBoardExtra(board.extra);
        return;
      }
      // `#chat` or anything else: the board's sessions under it; the address names the board so a reload does not reopen the dock.
      const chat = isChatHash(hash);
      setSection((s) => {
        const b = first ? { kind: 'board' as const, tab: 'sessions' as const } : s;
        if (hash) setBoardHash(b, true);
        return b;
      });
      if (chat) openChat();
    };
    follow(true);
    const onHash = () => follow(false);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [setSection, setBoardExtra]);
}
