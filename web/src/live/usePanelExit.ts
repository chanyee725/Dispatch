// Keeps a right panel mounted for its exit animation (#942): when the open value goes back to null, the last value
// stays for `ms` with `closing` set (the panel gets data-closing, live.css runs the 160ms slide-out), then unmounts.
// Switching to another value shows it at once.
import { useEffect, useState } from 'react';

export const EXIT_MS = 160;

export function usePanelExit<T>(value: T | null, ms = EXIT_MS): { shown: T | null; closing: boolean } {
  const [last, setLast] = useState<T | null>(value);
  if (value != null && value !== last) setLast(value);
  useEffect(() => {
    if (value != null || last == null) return;
    const t = setTimeout(() => setLast(null), ms);
    return () => clearTimeout(t);
  }, [value, last, ms]);
  return value != null ? { shown: value, closing: false } : { shown: last, closing: last != null };
}
