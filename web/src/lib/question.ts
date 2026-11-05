// Reads the question a session ended its turn with, for the "답할 것" card.
// Pure and import-free so `node --test` can run it; the text it reads stays in the browser.

export interface Question {
  /** The asking line, markdown stripped. */
  summary: string;
  /** Choices offered in the text (a list right before or after the question), or yes/no for a plain ask. */
  options: string[];
}

const ASK = /(\?|？)\s*$|(할까요|될까요|일까요|을까요|좋을까요|괜찮을까요|습니까|원하세요|주실래요|주시겠어요|답해\s?주세요|알려\s?주세요|골라\s?주세요|정해\s?주세요|선택해\s?주세요|결정해\s?주세요|승인해\s?주세요)[.!…\s]*$/;
// An open question ("어떤 이름으로 할까요?") has no yes/no answer.
const OPEN = /(무엇|뭐|뭘|무슨|어떤|어떻게|어느|어디|언제|누구|누가|몇|왜|얼마|\bwhich\b|\bwhat\b|\bhow\b|\bwhere\b|\bwhen\b|\bwho\b|\bwhy\b)/i;
const ITEM = /^\s*(?:[-*•]|\d{1,2}[.)]|[A-Za-z][.)]|[①-⑩])\s+(.+)$/;
const MAX_OPTIONS = 5;

const plain = (l: string) => l.replace(/[*_`]+/g, "").replace(/^[\s>#]+/, "").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A list item's short label: its head before a dash or colon explanation. */
function label(item: string): string {
  const t = plain(item);
  const head = t.split(/\s+[—–-]\s+|:\s+|：\s*/)[0].trim();
  return clip(head || t, 60);
}

/** The question a final answer ends with, or null when its last lines ask nothing. */
export function questionOf(text: string | null | undefined): Question | null {
  if (!text) return null;
  const lines = text.split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim());
  if (!lines.length) return null;

  // The asking line: in the last three lines, or the three right above a trailing list of choices.
  let listTop = lines.length;
  while (listTop > 0 && ITEM.test(lines[listTop - 1])) listTop--;
  const asks = (i: number) => ASK.test(plain(lines[i]).replace(/[*_`>#\s]+$/g, ""));
  let qi = -1;
  for (let i = lines.length - 1; i >= Math.max(0, Math.min(lines.length, listTop) - 3); i--) {
    if (i < lines.length - 3 && i >= listTop) continue;
    if (asks(i)) { qi = i; break; }
  }
  if (qi < 0) return null;
  const qLine = lines[qi];
  const qItem = ITEM.exec(qLine);
  // When the ask sits inside a list ("1. A로 할까요?"), the question is the line above the list.
  let start = qi;
  if (qItem) while (start > 0 && ITEM.test(lines[start - 1])) start--;
  const summaryLine = qItem && start > 0 ? lines[start - 1] : qLine;
  const summary = clip(plain(summaryLine), 240);

  // Options: the list right after the question, else the list that ends right before it.
  const block = (from: number, step: 1 | -1) => {
    const out: string[] = [];
    for (let i = from; i >= 0 && i < lines.length; i += step) {
      const m = ITEM.exec(lines[i]);
      if (!m) break;
      out.push(m[1]);
    }
    return step === 1 ? out : out.reverse();
  };
  let items = qItem ? block(start, 1) : block(qi + 1, 1);
  if (items.length < 2 && !qItem) items = block(qi - 1, -1);
  const options = items.length >= 2 ? [...new Set(items.map(label).filter(Boolean))].slice(0, MAX_OPTIONS) : [];

  if (!options.length && !OPEN.test(summary)) return { summary, options: ["네, 진행해 주세요", "아니요, 멈춰 주세요"] };
  return { summary, options };
}
