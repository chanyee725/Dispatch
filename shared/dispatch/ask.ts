// Whether a turn's final answer ends by asking its reader something — shared by the server
// (session state) and the web (the "답할 것" card) so both read a question the same way.
// Import-free, so the server (Node type stripping) and Vite load it as is.

/** Phrases that hand a decision to the reader, matched at the end of a line. */
export const ASK: RegExp = /(\?|？)\s*$|(할까요|될까요|일까요|을까요|좋을까요|괜찮을까요|습니까|원하세요|주실래요|주시겠어요|답해\s?주세요|알려\s?주세요|골라\s?주세요|정해\s?주세요|선택해\s?주세요|결정해\s?주세요|승인해\s?주세요)[.!…\s]*$/;

/** A list item: "- x", "1. x", "2) x", "a. x", "① x". Group 1 is the item text. */
export const ITEM: RegExp = /^\s*(?:[-*•]|\d{1,2}[.)]|[A-Za-z][.)]|[①-⑩])\s+(.+)$/;

/** A line without emphasis marks or a leading quote/heading marker. */
export const plain = (l: string): string => l.replace(/[*_`]+/g, "").replace(/^[\s>#]+/, "").trim();

/** Non-blank lines of a text, right-trimmed. */
export const linesOf = (text: string | null | undefined): string[] => String(text ?? "").split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim());

/**
 * Index of the asking line in `lines`, or -1. Only the last three lines count, plus the three right
 * above a trailing list of choices — so "어느 쪽으로 갈까요?" followed by any number of options still
 * asks, while a question quoted mid-answer does not.
 */
export function askIndex(lines: string[]): number {
  let listTop = lines.length;
  while (listTop > 0 && ITEM.test(lines[listTop - 1]!)) listTop--;
  for (let i = lines.length - 1; i >= Math.max(0, listTop - 3); i--) {
    if (i < lines.length - 3 && i >= listTop) continue;
    if (ASK.test(plain(lines[i]!).replace(/[>#\s]+$/g, ""))) return i;
  }
  return -1;
}

/**
 * The asking sentence a final answer ends with (markdown stripped, at most `max` characters), or "" when its
 * last lines ask nothing. When the ask sits inside a list ("1. A로 할까요?"), it is the line above the list.
 */
export function askLineOf(text: string | null | undefined, max = 200): string {
  const lines = linesOf(text);
  const qi = askIndex(lines);
  if (qi < 0) return "";
  let start = qi;
  const inList = ITEM.test(lines[qi]!);
  if (inList) while (start > 0 && ITEM.test(lines[start - 1]!)) start--;
  const line = plain((inList && start > 0 ? lines[start - 1] : lines[qi])!);
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
