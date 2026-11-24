// The last value a polled read returned, kept at module level so a component that mounts again (the sidebar usage
// card opens on every hover, #705) starts from it instead of a loading state, and refreshes in place.
// Metadata only (usage percentages, guard thresholds); nothing is stored beyond this page's memory.

export type Kept<T> = {
  /** The last value, 'failed' when the first read failed, null before any read. */
  get(): T | 'failed' | null;
  /** Records a read: a value replaces the last one; a failure keeps the last value when there is one. */
  put(next: T | 'failed'): T | 'failed';
};

export function lastValue<T>(): Kept<T> {
  let last: T | 'failed' | null = null;
  return {
    get: () => last,
    put(next) {
      last = next === 'failed' && last !== null && last !== 'failed' ? last : next;
      return last;
    },
  };
}
