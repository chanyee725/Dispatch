import path from "node:path";
import { fileURLToPath } from "node:url";
import { ownGitEnv } from "./cli.js";
import { redact, redactDeep } from "./redact.js";
import { PERMS } from "./roles.js";

// Module-level helpers and provider constants shared by Hub and its mixins (hub-*.js).
// Kept in a leaf module so the mixins never import hub.js (no import cycle).
export const badRequest = msg => Object.assign(new Error(msg), { status: 400 });

// Providers that run, as in standalone Dispatch (issue #587). A session saved with any other provider
// stays readable, but nothing may start for it.
export const PROVIDERS = ["claude", "openai", "gemini"];
export const UNSUPPORTED_MODEL = "이 세션은 지원하지 않는 모델이에요";
export const PROVIDER_NAMES = { claude: "Claude", openai: "OpenAI Codex", gemini: "Gemini" };

// codex exec and agy -p run headless with no way to ask before a tool call, so neither can honour
// manual (ask before every tool): it is refused, never run looser (CLAUDE.md).
// agy's own names for the modes it is given (never --dangerously-skip-permissions).
export const AGY_MODES = { acceptEdits: "accept-edits", auto: "auto", plan: "plan" };
// Codex's sandbox per mode. workspace-write runs commands without asking, which is looser than
// acceptEdits (edits only), so Codex runs plan (read-only) and auto (workspace-write) only.
export const CODEX_SANDBOX = { auto: "workspace-write", plan: "read-only" };
export const MODES_OF = { openai: CODEX_SANDBOX, gemini: AGY_MODES };

// Refuse a mode that is unknown or that the provider would run looser than chosen.
// Modes: manual, acceptEdits, auto, plan (never bypassPermissions).
export function checkPerm(provider, perm) {
  if (!PERMS.includes(perm)) throw badRequest("알 수 없는 권한 모드예요");
  const modes = MODES_OF[provider];
  if (modes && !modes[perm]) {
    throw badRequest(`${PROVIDER_NAMES[provider]}는 ${perm} 모드를 쓸 수 없어요. ${Object.keys(modes).join("·")} 중에서 골라 주세요`);
  }
  return perm;
}

// Effort words are passed into CLI args, so only plain words are allowed.
export const EFFORT_WORDS = ["minimal", "none", "low", "medium", "high", "xhigh", "max"];
export function checkEffort(model, effort) {
  if (effort == null || effort === "") return effort || null;
  const allowed = (model.efforts || []).filter(e => EFFORT_WORDS.includes(e));
  if (!allowed.includes(effort)) throw badRequest("이 모델에서 쓸 수 없는 생각 수준이에요");
  return effort;
}

export const MCP_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp.js");
export const MAX_TRANSCRIPT = 400;
export const STALL_MS = 10 * 60 * 1000;
// After teamSettings().rotateLead / rotateOthers turns a session continues in a fresh CLI session
// (a handoff note carries the essentials), so a long-lived lead does not keep re-reading an
// ever-growing context. Leads take many short turns, so they rotate sooner. 0 turns it off.
export const RESUME_TEXT = "[Dispatch] 서버가 재시작되어 직전 턴이 중간에 끊겼다. 작업 폴더와 브랜치 상태를 확인하고 하던 일을 이어서 끝내라.";
// Browser tools in team sessions run headless, each in its own throwaway profile, so checks never pop
// windows on the user's screen or steer another session's tab. A session can still opt out via its own env.
export const SESSION_ENV = { PLAYWRIGHT_MCP_HEADLESS: "true", PLAYWRIGHT_MCP_ISOLATED: "true" };
// DRAWING_SESSION: the session's id, sent back as `x-drawing-session` on its workspace API writes so its cursor is
// credited for certain, not guessed (#656).
export const sessionEnv = s => ({ ...SESSION_ENV, ...ownGitEnv(), DRAWING_SESSION: s.id });
export const isOpenStatus = st => !["done", "error"].includes(st);
export const clip = (s, n = 2000) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; };

/**
 * A Claude stream-json user message body: plain text, or (with images, #968) image blocks then the text block.
 * `images` are [{ mediaType, data }] already checked by routes.js (type, size, count).
 */
/** A saved Claude CLI session id the chat may resume (same shape chat-store.js keeps). */
export const RESUME_ID = /^[A-Za-z0-9_-]{1,80}$/;

export const userContent = (text, images) => !images?.length ? text : [
  ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } })),
  ...(text ? [{ type: "text", text }] : []),
];

// Splits a child's stdout into JSON lines. A last line without a trailing newline is read when the stream ends.
export function onJsonLines(stream, fn) {
  let buf = "";
  const take = raw => {
    const line = raw.trim();
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    fn(msg);
  };
  stream.on("data", d => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      take(line);
    }
  });
  stream.on("end", () => { const line = buf; buf = ""; take(line); });
}

/** A short Korean label for what a tool call is doing, from its name and (for shells) its command. */
export function activityOf(name = "", text = "") {
  const t = String(text);
  if (/^(Bash|shell)$/i.test(name)) {
    if (/playwright/.test(t)) return "e2e 실행";
    if (/vitest|jest|npm (run )?test\b|pytest/.test(t)) return "단위 테스트";
    if (/\btsc\b|typecheck/.test(t)) return "타입 검사";
    if (/eslint|npm run lint/.test(t)) return "lint";
    if (/next build|vite build|npm run build/.test(t)) return "빌드";
    if (/\bgit\b[^|;&]*\b(merge|cherry-pick|rebase)\b/.test(t)) return "병합";
    if (/\bgit\b[^|;&]*\bcommit\b/.test(t)) return "커밋";
    if (/\bgit\b[^|;&]*\b(diff|log|show|status)\b/.test(t)) return "변경 확인";
    if (/npm (i|install|ci)\b/.test(t)) return "패키지 설치";
    if (/^\W*"?(\{"command":"?)?\s*(cat|sed -n|grep|rg|ls|find|head|tail)\b/.test(t)) return "코드 읽기";
    return "명령 실행";
  }
  if (/^(Edit|Write|MultiEdit|NotebookEdit|edit)$/.test(name)) return "파일 수정";
  if (/^(Read|Grep|Glob)$/.test(name)) return "코드 읽기";
  if (name === "Skill") return "스킬 불러오기";
  if (/^mcp__dispatch__/.test(name) || /^dispatch\./.test(name)) return "팀 관리";
  if (/^mcp__.*playwright|^browser_/.test(name)) return "화면 확인";
  if (/^Web(Fetch|Search)$/.test(name)) return "웹 검색";
  if (/^(Monitor|TaskStop|TaskOutput|ToolSearch)$/.test(name)) return "기다리는 중";
  return name.replace(/^mcp__[^_]+__/, "");
}

/** A permission request as the UI may see it: tool input, description and suggestions masked. */
export function maskedPerm(req) {
  return { ...req, input: redactDeep(req.input), description: redact(req.description), suggestions: redactDeep(req.suggestions) };
}

// Copies a mixin class's methods and getters onto target.prototype (non-enumerable, like class members),
// so the split-out parts of Hub stay plain Hub.prototype members.
/** @param {Function} target @param {...Function} sources */
export function mixin(target, ...sources) {
  for (const src of sources) {
    const { constructor: _c, ...members } = Object.getOwnPropertyDescriptors(src.prototype);
    Object.defineProperties(target.prototype, members);
  }
}

/**
 * `this` inside the mixin methods (type-only, for checkJs): Hub with every mixin's members.
 * @typedef {import("./hub.js").Hub & import("./hub-runners.js").HubRunners & import("./hub-tickets.js").HubTickets
 *   & import("./hub-auto-remove.js").HubAutoRemove} HubThis
 */
