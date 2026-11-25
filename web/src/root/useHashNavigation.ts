import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { parseBoardHash, type BoardExtra, type Section } from '../projectNav';
import { setBoardHash } from './hashRoute';

type HashNavigation = {
  setSection: Dispatch<SetStateAction<Section>>;
  setBoardExtra: (extra: BoardExtra) => void;
};

/** Follows board addresses and normalizes old links to the board. */
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
      setSection((s) => {
        const b = first ? { kind: 'board' as const, tab: 'sessions' as const } : s;
        if (hash) setBoardHash(b, true);
        return b;
      });
    };
    follow(true);
    const onHash = () => follow(false);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [setSection, setBoardExtra]);
}
