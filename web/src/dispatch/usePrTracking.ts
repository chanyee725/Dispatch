// React hooks over the shared PR/CI tracking controller (prTracking.ts) and the status line (../statusLine.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createStatusLine, type StatusLine } from '../statusLine.ts';
import { createPrTracking, type PrState } from './prTracking.ts';

/** Status line state for a component: `note` is its text, `status` the stable writer. */
export function useStatusLine() {
  const [note, setNote] = useState<string | null>(null);
  const status = useMemo(() => createStatusLine(setNote), []);
  useEffect(() => () => status.dispose(), [status]);
  return { note, status };
}

export function usePrTracking(status: StatusLine, savedNote?: string) {
  const [pr, setPr] = useState<PrState>(null);
  const ctl = useRef<ReturnType<typeof createPrTracking> | null>(null);
  ctl.current ??= createPrTracking({ status, onState: setPr, savedNote });
  useEffect(() => {
    const c = ctl.current!;
    c.attach();
    void c.load();
    return () => c.dispose();
  }, []);
  return { pr, toggle: (on: boolean) => void ctl.current!.toggle(on), broken: typeof pr === 'object' && pr !== null ? pr.broken : null };
}
