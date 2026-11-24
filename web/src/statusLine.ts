// One status line with one writer, shared by every action that reports into it (today the PR/CI switch).
//
// announce() clears the line, then writes the text DELAY ms later, so a live region sees an empty state in between
// (screen readers skip a same-text rewrite that lands in the same tick) and a repeated message is read again (#419 item 1).
// The newest action *started* owns the line: each action takes a ticket with begin(), and a result that arrives under an
// older ticket never writes (#416, #419 items 3/5).
// An older action's *error* is not silently lost while the newest one is still in flight: it is carried and appended to
// the text that newest action writes. Once the newest action has already written, a late older error is dropped:
// it describes a state that was superseded, and holding it would attach it to some unrelated later message (#425).
export const STATUS_DELAY_MS = 120;

export type StatusLine = {
  /** Start an action; the returned ticket must be passed to announce()/isNewest(). */
  begin(): number;
  /** True while no newer action has started. */
  isNewest(ticket: number): boolean;
  announce(ticket: number, text: string, isError?: boolean): void;
  /** Forget a carried error, e.g. when another line already shows the real cause. The newest action counts as
   *  settled, so a late error from an older action is dropped too (#433). */
  dropCarried(): void;
  /** Stop a pending write (unmount). The line stays usable. */
  dispose(): void;
};

export function createStatusLine(write: (text: string | null) => void, delayMs = STATUS_DELAY_MS): StatusLine {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  let writtenSeq = 0; // ticket whose text is on screen
  let pendingError: string | null = null; // newest action's error still waiting for its timer
  let carried: string | null = null;
  return {
    begin() {
      clearTimeout(timer);
      if (pendingError) carried = pendingError;
      pendingError = null;
      write(null);
      return ++seq;
    },
    isNewest: (ticket) => ticket === seq,
    announce(ticket, text, isError = false) {
      if (ticket !== seq) {
        if (isError && writtenSeq !== seq) carried = text;
        return;
      }
      clearTimeout(timer);
      pendingError = isError ? text : null;
      timer = setTimeout(() => {
        if (ticket !== seq) return;
        const extra = carried && carried !== text ? carried : null;
        carried = null;
        pendingError = null;
        writtenSeq = ticket;
        write(extra ? (text ? `${text} ${extra}` : extra) : text);
      }, delayMs);
    },
    dropCarried() {
      carried = null;
      writtenSeq = seq;
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
