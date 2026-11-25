/** Clears saved chats when explicitly requested from Settings. */
export async function clearChats(): Promise<number> {
  const res = await fetch('/api/chats', {
    method: 'DELETE',
    headers: { 'x-drawing': '1', 'x-drawing-client': 'app' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`), { status: res.status });
  return data.removed;
}
