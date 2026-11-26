import { useCallback, useState } from 'react';

export const RESIZE_STEP = 16;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSize(key: string, fallback: number, normalize: (size: number) => number, s: Storage | null = storage()): number {
  try {
    const raw = s?.getItem(key);
    return raw == null || raw.trim() === '' ? fallback : normalize(Number(raw));
  } catch {
    return fallback;
  }
}

export function writeSize(key: string, size: number, s: Storage | null = storage()): void {
  try {
    s?.setItem(key, String(size));
  } catch {
    /* The size still applies for this page. */
  }
}

export function useResizeSize(key: string, fallback: number, normalize: (size: number) => number) {
  const [savedSize, setSavedSize] = useState(() => readSize(key, fallback, normalize));
  const [previewSize, setPreviewSize] = useState<number | null>(null);
  const preview = useCallback((size: number) => setPreviewSize(normalize(size)), [normalize]);
  const cancel = useCallback(() => setPreviewSize(null), []);
  const commit = useCallback((size: number) => {
    const next = normalize(size);
    setSavedSize(next);
    setPreviewSize(null);
    writeSize(key, next);
  }, [key, normalize]);
  return { size: previewSize ?? savedSize, preview, commit, cancel };
}
