/** True when a dynamic import failed because the chunk is gone or unreachable (typically after a rebuild). */
export function isChunkLoadError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { name, message } = e as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  const m = typeof message === 'string' ? message : '';
  return /dynamically imported module|importing a module script failed|loading chunk|loading css chunk|unable to preload css/i.test(m);
}

export const CHUNK_MESSAGE = '새 버전이 있어요. 새로고침해 주세요';
export const CRASH_MESSAGE = '화면을 그리지 못했어요. 새로고침해 주세요';

export const noticeFor = (e: unknown) => (isChunkLoadError(e) ? CHUNK_MESSAGE : CRASH_MESSAGE);
