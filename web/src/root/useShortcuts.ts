import { useEffect } from 'react';
import { shellKey } from '../projectNav';

// Shell shortcut: S 세션 보드. Never inside a text field, an editor or a dialog: see shellKey.
export function useShellShortcuts(showBoard: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shellKey(e) !== 'board') return;
      e.preventDefault();
      showBoard();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showBoard]);
}
