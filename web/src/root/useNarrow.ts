import { useEffect, useState } from 'react';

const NARROW = '(max-width: 767px)';

/** Below md only one pane fits (design doc 6 §6). */
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const h = () => setNarrow(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return narrow;
}
