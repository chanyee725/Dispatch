// One time label for the whole app (#889): relative inside a week, a plain date after that.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * "방금", "5분 전", "3시간 전", "2일 전" inside 7 days; then "11월 12일" ("2025년 11월 12일" in another year).
 * A time in the future (clock skew) reads as "방금".
 */
export function whenLabel(at: number, now = Date.now()): string {
  const d = Math.max(0, now - at);
  if (d < MIN) return '방금';
  if (d < HOUR) return `${Math.floor(d / MIN)}분 전`;
  if (d < DAY) return `${Math.floor(d / HOUR)}시간 전`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}일 전`;
  const x = new Date(at);
  const md = `${x.getMonth() + 1}월 ${x.getDate()}일`;
  return x.getFullYear() === new Date(now).getFullYear() ? md : `${x.getFullYear()}년 ${md}`;
}

/** Exact date and time, e.g. "2026. 11. 21. 오후 3:05", for version and trash lists. */
export const dateTimeLabel = (t: number) => new Date(t).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
