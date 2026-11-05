// Whether a turn's final answer ends by asking its reader something — shared by the server
// (session state) and the web (the "답할 것" card) so both read a question the same way.
// Plain, import-free JavaScript: the server stays dependency-free and Vite bundles it as is.

/** Phrases that hand a decision to the reader, matched at the end of a line. */
export const ASK = /(\?|？)\s*$|(할까요|될까요|일까요|을까요|좋을까요|괜찮을까요|습니까|원하세요|주실래요|주시겠어요|답해\s?주세요|알려\s?주세요|골라\s?주세요|정해\s?주세요|선택해\s?주세요|결정해\s?주세요|승인해\s?주세요)[.!…\s]*$/;

/** A list item: "- x", "1. x", "2) x", "a. x", "① x". Group 1 is the item text. */
export const ITEM = /^\s*(?:[-*•]|\d{1,2}[.)]|[A-Za-z][.)]|[①-⑩])\s+(.+)$/;

/** A line without emphasis marks or a leading quote/heading marker. */
export const plain = l => l.replace(/[*_`]+/g, "").replace(/^[\s>#]+/, "").trim();

/** Non-blank lines of a text, right-trimmed. */
export const linesOf = text => String(text ?? "").split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim());

/**
 * Index of the asking line in `lines`, or -1. Only the last three lines count, plus the three right
 * above a trailing list of choices — so "어느 쪽으로 갈까요?" followed by any number of options still
 * asks, while a question quoted mid-answer does not.
 */
export function askIndex(lines) {
  let listTop = lines.length;
  while (listTop > 0 && ITEM.test(lines[listTop - 1])) listTop--;
  for (let i = lines.length - 1; i >= Math.max(0, listTop - 3); i--) {
    if (i < lines.length - 3 && i >= listTop) continue;
    if (ASK.test(plain(lines[i]).replace(/[>#\s]+$/g, ""))) return i;
  }
  return -1;
}
