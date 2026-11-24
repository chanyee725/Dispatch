// Reads the question a session ended its turn with, for the "답할 것" card.
// Pure (its only import is ./ask.ts); the text it reads stays in the browser.
import { ITEM, askIndex, linesOf, plain } from './ask.ts';

export interface Question {
  /** The asking line, markdown stripped. */
  summary: string;
  /** Choices offered in the text (a list right before or after the question), or yes/no for a plain ask. */
  options: string[];
}

// An open question ("어떤 이름으로 할까요?") has no yes/no answer.
const OPEN = /(무엇|뭐|뭘|무슨|어떤|어떻게|어느|어디|언제|누구|누가|몇|왜|얼마|\bwhich\b|\bwhat\b|\bhow\b|\bwhere\b|\bwhen\b|\bwho\b|\bwhy\b)/i;
const MAX_OPTIONS = 5;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A list item's short label: its head before a dash or colon explanation. */
function label(item: string): string {
  const t = plain(item);
  const head = (t.split(/\s+[—–-]\s+|:\s+|：\s*/)[0] ?? '').trim();
  return clip(head || t, 60);
}

/** The question a final answer ends with, or null when its last lines ask nothing. */
export function questionOf(text: string | null | undefined): Question | null {
  if (!text) return null;
  const lines = linesOf(text);
  const qi = askIndex(lines);
  if (qi < 0) return null;
  const qLine = lines[qi]!;
  const qItem = ITEM.exec(qLine);
  // When the ask sits inside a list ("1. A로 할까요?"), the question is the line above the list.
  let start = qi;
  if (qItem) while (start > 0 && ITEM.test(lines[start - 1]!)) start--;
  const summaryLine = qItem && start > 0 ? lines[start - 1]! : qLine;
  const summary = clip(plain(summaryLine), 240);

  // Options: the list right after the question, else the list that ends right before it.
  const block = (from: number, step: 1 | -1) => {
    const out: string[] = [];
    for (let i = from; i >= 0 && i < lines.length; i += step) {
      const m = ITEM.exec(lines[i]!);
      if (!m) break;
      out.push(m[1]!);
    }
    return step === 1 ? out : out.reverse();
  };
  let items = qItem ? block(start, 1) : block(qi + 1, 1);
  if (items.length < 2 && !qItem) items = block(qi - 1, -1);
  const options = items.length >= 2 ? [...new Set(items.map(label).filter(Boolean))].slice(0, MAX_OPTIONS) : [];

  if (!options.length && !OPEN.test(summary)) return { summary, options: ['네, 진행해 주세요', '아니요, 멈춰 주세요'] };
  return { summary, options };
}

/** One choice of a question in the tabbed card (#1052). */
export interface QuestionOption {
  label: string;
  /** The one-line reason after the label ("라벨 — 이유"), if any. */
  reason?: string;
  recommended?: boolean;
}

/** One question of a set shown as tabs 1/2/3/4: from AskUserQuestion's input or from "질문 N/M:" text. */
export interface QuestionItem {
  question: string;
  /** Short tab caption (AskUserQuestion's `header`). */
  header?: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/** "질문 2/4: 어느 쪽으로 할까요?" — group 1 is N, 2 is M, 3 the question. */
const NUMBERED = /^(?:질문|question|q)\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*[:：.)]\s*(.+)$/i;
const RECOMMENDED = /\s*[(（]\s*(?:추천|recommended)\s*[)）]\s*/i;
const MULTI = /여러\s?개|복수\s?선택|모두\s?골라|다\s?골라|multiple|select all/i;
const MAX_ITEMS = 8;

/** "B안 (추천) — 빠름" → { label: 'B안', reason: '빠름', recommended: true }. */
export function optionOf(item: string): QuestionOption {
  let t = plain(item);
  const recommended = RECOMMENDED.test(t);
  if (recommended) t = t.replace(RECOMMENDED, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(.+?)(?:\s+[—–-]\s+|:\s+|：\s*)(.+)$/.exec(t);
  const out: QuestionOption = { label: clip((m ? m[1]! : t).trim(), 80) };
  if (m) out.reason = clip(m[2]!.trim(), 160);
  if (recommended) out.recommended = true;
  return out;
}

/**
 * The numbered questions ("질문 1/4: …?" each followed by its 2–4 numbered choices) a text asks, in order, or null
 * when it has none. A text with a single "질문 1/1:" is a set of one.
 */
export function questionsOf(text: string | null | undefined): QuestionItem[] | null {
  if (!text) return null;
  const lines = linesOf(text);
  const found: { n: number; at: number; q: string }[] = [];
  lines.forEach((l, i) => {
    const m = NUMBERED.exec(plain(l));
    if (m) found.push({ n: Number(m[1]), at: i, q: m[3]!.trim() });
  });
  if (!found.length) return null;
  // A later "질문 1/…" starts a new set (a revised list): keep the last set only.
  let first = 0;
  for (let k = 1; k < found.length; k++) if (found[k]!.n <= found[k - 1]!.n) first = k;
  const set = found.slice(first, first + MAX_ITEMS);
  const items = set.map((f, k) => {
    const end = k + 1 < set.length ? set[k + 1]!.at : lines.length;
    const options: QuestionOption[] = [];
    for (let i = f.at + 1; i < end; i++) {
      const m = ITEM.exec(lines[i]!);
      if (!m) { if (options.length) break; continue; }
      const o = optionOf(m[1]!);
      if (o.label && !options.some(x => x.label === o.label)) options.push(o);
    }
    return { question: clip(plain(f.q), 240), options: options.slice(0, MAX_OPTIONS), multiSelect: MULTI.test(f.q) };
  });
  return items;
}

/** One answer in the card: the picked labels plus the "직접 입력" text. */
export interface QuestionAnswer {
  picked: string[];
  other: string;
}

/** The answer as one string ("A, B, 직접 쓴 말"), or "" when nothing is picked or typed. */
export function answerValue(a: QuestionAnswer | undefined): string {
  if (!a) return '';
  return [...a.picked, a.other.trim()].filter(Boolean).join(', ');
}

/** All answers of a text question set as one message, one question per block. */
export function answersMessage(items: readonly QuestionItem[], answers: readonly (QuestionAnswer | undefined)[]): string {
  const m = items.length;
  return items.map((q, i) => `질문 ${i + 1}/${m}: ${q.question}\n답: ${answerValue(answers[i]) || '(답 없음)'}`).join('\n\n');
}

/** Shown when a session waits for an answer but no question can be read (#886): never an empty card. */
export const NO_QUESTION: Question = { summary: '질문 내용을 찾지 못했어요. 대화의 마지막 메시지를 보고 답해 주세요.', options: [] };

/**
 * The "답할 것" card's question: from the last assistant entry of this turn in the tab's transcript, else from the
 * server's `ask` (kept for the session even when the transcript is not loaded and `last` cut the question off), else
 * NO_QUESTION.
 */
export function answerQuestion(
  s: { ask?: string | null },
  entries: readonly { kind: string; text: string }[] | undefined,
): Question {
  const text = lastAnswerText(entries);
  return questionOf(text) ?? questionOf(s.ask) ?? (s.ask ? { summary: clip(s.ask, 240), options: [] } : NO_QUESTION);
}

type EntryLike = { kind: string; text: string };

/** The last assistant text of the current turn (nothing after the person's last message), if any. */
function lastAnswerText(entries: readonly EntryLike[] | undefined): string | undefined {
  for (let i = (entries?.length ?? 0) - 1; i >= 0; i--) {
    const e = entries![i]!;
    if (e.kind === 'user') return undefined;
    if (e.kind === 'assistant') return e.text;
  }
  return undefined;
}

/** The "답할 것" card's numbered question set (#1052), from the transcript, else the server's `ask`, else null. */
export function answerQuestions(s: { ask?: string | null }, entries: readonly EntryLike[] | undefined): QuestionItem[] | null {
  return questionsOf(lastAnswerText(entries)) ?? questionsOf(s.ask);
}

/**
 * React key of the Codex/Gemini question card (#1052 follow-up): one per request, i.e. per finished turn, so a
 * question set asked again in a later turn gets a fresh card (its `sent` guard reset) even with the same text.
 */
export function questionSetKey(s: { turns: number }, items: readonly QuestionItem[]): string {
  return `${s.turns}\n${items.map(q => q.question).join('\n')}`;
}
