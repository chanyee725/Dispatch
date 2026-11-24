// App event toasts (E540, #671): what the user and the workspace did — files created, deleted or moved, a project
// made, sessions and teams started or ended, a model connected, settings saved, pipeline runs, PR changes — mapped to
// short 해요체 toasts that share the agent activity stack (ActivityAlerts). Pure (no React or DOM), so it runs under
// `node --test`. Metadata only: paths, session names (never real names), provider names, PR numbers.
import {
  fileStemOf,
  objectOf,
  subjectOf,
} from "../../../shared/dispatch/agent-activity.ts";

/** Toast categories. "agents" and "files" stay in the type for saved preferences, but documents are gone, so 설정 no longer lists them. */
export type ToastCategory =
  "agents" | "files" | "sessions" | "models" | "runs" | "settings";

export const TOAST_CATEGORIES: { id: ToastCategory; label: string }[] = [
  { id: "sessions", label: "팀과 세션" },
  { id: "models", label: "모델 연결" },
  { id: "runs", label: "PR 변화" },
  { id: "settings", label: "설정 저장" },
];

export type EntryKind = "doc" | "canvas" | "folder" | "project";

export type AppEvent =
  | { type: "saved"; path: string }
  | { type: "save-failed"; path: string }
  | { type: "created"; kind: EntryKind; path: string; title?: string }
  | { type: "deleted"; kind: EntryKind; path: string }
  | { type: "moved"; kind: EntryKind; from: string; to: string }
  | { type: "renamed"; kind: EntryKind; from: string; to: string }
  | {
      type: "session-started";
      id: string;
      name: string;
      team: boolean;
      role?: string;
      provider?: string;
    }
  | {
      type: "session-ended";
      id: string;
      name: string;
      role?: string;
      provider?: string;
    }
  | {
      type: "session-error";
      id: string;
      name: string;
      role?: string;
      provider?: string;
    }
  | {
      type: "session-asks";
      id: string;
      name: string;
      ask: string;
      since?: number;
      role?: string;
      provider?: string;
    }
  | {
      type: "session-rotated";
      id: string;
      name: string;
      from: string;
      mtok: number;
      role?: string;
      provider?: string;
    }
  | { type: "model-connected"; provider: string; name: string }
  | { type: "model-disconnected"; provider: string; name: string }
  | { type: "model-error"; provider: string; name: string }
  | { type: "settings-saved" }
  | { type: "run-started"; file: string; runId: string }
  | { type: "run-ended"; file: string; runId: string; failed: boolean }
  | { type: "pr"; file: string; number: number; state: string }
  | { type: "plan-waiting"; file: string; text: string };

export type ToastTone = "info" | "success" | "error";
/** Where 열기 goes: a document (by path) or a session (opens /dispatch). */
export type ToastTarget = { file: string } | { session: string };

export interface AppToast {
  /** Same key → the same toast; a repeat within the dedupe window is dropped. */
  key: string;
  category: ToastCategory;
  tone: ToastTone;
  text: string;
  /** Errors stay until dismissed; the rest close by themselves. */
  persist: boolean;
  target?: ToastTarget;
}

const NOUN: Record<EntryKind, string> = {
  doc: "문서",
  canvas: "캔버스",
  folder: "폴더",
  project: "프로젝트",
};
const nameOf = (path: string) => fileStemOf(path.replace(/\/+$/, "")) || path;
/** "‘설계’ 문서" — the entry's own name in quotes, then what it is. */
const label = (kind: EntryKind, path: string, title?: string) =>
  `‘${(title || nameOf(path)).slice(0, 40)}’ ${NOUN[kind]}`;
/** A short signature of a text, so a key tells two texts apart without holding either. */
const textSig = (t: string) => {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
const PR_STATE: Record<string, string> = {
  open: "열렸어요",
  merged: "병합됐어요",
  closed: "닫혔어요",
};

/** The toast for one event; null when it says nothing worth a toast (an unknown PR state). */
export function toastOf(e: AppEvent): AppToast | null {
  const info = (
    category: ToastCategory,
    key: string,
    text: string,
    target?: ToastTarget,
  ): AppToast => ({
    key,
    category,
    tone: "info",
    text,
    persist: false,
    ...(target ? { target } : {}),
  });
  const error = (
    category: ToastCategory,
    key: string,
    text: string,
    target?: ToastTarget,
  ): AppToast => ({
    ...info(category, key, text, target),
    tone: "error",
    persist: true,
  });
  switch (e.type) {
    case "saved":
      return info("files", `saved:${e.path}`, "저장했어요");
    case "save-failed":
      return error("files", `save-failed:${e.path}`, "저장하지 못했어요");
    case "created":
      return info(
        "files",
        `created:${e.path}`,
        `${objectOf(label(e.kind, e.path, e.title))} 만들었어요`,
        e.kind === "doc" || e.kind === "canvas" ? { file: e.path } : undefined,
      );
    case "deleted":
      return info(
        "files",
        `deleted:${e.path}`,
        `${objectOf(label(e.kind, e.path))} 지웠어요`,
      );
    case "moved":
      return info(
        "files",
        `moved:${e.from}>${e.to}`,
        `${objectOf(label(e.kind, e.to))} 옮겼어요`,
        e.kind === "doc" ? { file: e.to } : undefined,
      );
    case "renamed":
      return info(
        "files",
        `renamed:${e.from}>${e.to}`,
        `${label(e.kind, e.to)}로 이름을 바꿨어요`,
        e.kind === "doc" ? { file: e.to } : undefined,
      );
    case "session-started":
    case "session-ended":
    case "session-error": {
      return e.type === "session-error"
        ? error(
            "sessions",
            `session-error:${e.id}`,
            `${e.name} 세션에 오류가 났어요`,
            { session: e.id },
          )
        : e.type === "session-ended"
          ? info(
              "sessions",
              `session-ended:${e.id}`,
              `${e.name} 세션이 끝났어요`,
              { session: e.id },
            )
          : e.team
            ? info(
                "sessions",
                `session-started:${e.id}`,
                `${subjectOf(`${e.name} 팀`)} 만들어졌어요`,
                { session: e.id },
              )
            : info(
                "sessions",
                `session-started:${e.id}`,
                `${e.name} 세션을 시작했어요`,
                { session: e.id },
              );
    }
    case "session-asks":
      // Stays until closed: a question left unseen stalls the team (#886). 열기 goes to the session's live view.
      return {
        ...info(
          "sessions",
          `session-asks:${e.id}:${e.since ?? textSig(e.ask)}`,
          `${e.name} 세션이 답을 기다려요: ${e.ask}`,
          { session: e.id },
        ),
        persist: true,
      };
    case "session-rotated":
      // A long session swapped for a fresh one by the system (#969): token count and session names only.
      return {
        ...info(
          "sessions",
          `session-rotated:${e.id}`,
          `누적 ${e.mtok}M 토큰이라 새 세션 ${e.name}로 바꿨어요`,
          { session: e.id },
        ),
      };
    case "model-connected":
      return info(
        "models",
        `model:${e.provider}:on`,
        `${objectOf(e.name)} 연결했어요`,
      );
    case "model-disconnected":
      return info(
        "models",
        `model:${e.provider}:off`,
        `${e.name} 연결을 끊었어요`,
      );
    case "model-error":
      return error(
        "models",
        `model:${e.provider}:error`,
        `${e.name} 연결에 문제가 있어요`,
      );
    case "settings-saved":
      return info("settings", "settings-saved", "설정을 저장했어요");
    case "run-started":
      return info(
        "runs",
        `run-started:${e.runId}`,
        `${nameOf(e.file)} 파이프라인 실행을 시작했어요`,
        { file: e.file },
      );
    case "run-ended":
      return e.failed
        ? error(
            "runs",
            `run-ended:${e.runId}`,
            `${nameOf(e.file)} 파이프라인 실행이 실패했어요`,
            { file: e.file },
          )
        : info(
            "runs",
            `run-ended:${e.runId}`,
            `${nameOf(e.file)} 파이프라인 실행이 끝났어요`,
            { file: e.file },
          );
    case "plan-waiting":
      return info("runs", `plan-waiting:${e.file}`, e.text, { file: e.file });
    case "pr": {
      const said = PR_STATE[e.state];
      return said
        ? info(
            "runs",
            `pr:${e.number}:${e.state}`,
            `${subjectOf(`PR #${e.number}`)} ${said}`,
            { file: e.file },
          )
        : null;
    }
  }
}

/** Results of what the person just did (#899): they pop up as a Sonner toast and nothing else pops up. */
const ACTION_EVENTS: ReadonlySet<AppEvent["type"]> = new Set([
  "saved",
  "save-failed",
  "created",
  "deleted",
  "moved",
  "renamed",
]);

export interface ActionToast {
  /** Same id → Sonner updates the toast in place instead of stacking a second one. */
  id: string;
  category: ToastCategory;
  tone: "success" | "error";
  text: string;
}

/** The toast for an action result; null for anything else (agent and workspace events never pop up). */
export function actionToastOf(e: AppEvent): ActionToast | null {
  if (!ACTION_EVENTS.has(e.type)) return null;
  const t = toastOf(e);
  return (
    t && {
      id: t.key,
      category: t.category,
      tone: t.tone === "error" ? "error" : "success",
      text: t.text,
    }
  );
}

/** Repeats of one key within this window show once (a burst of saves, an echo from another tab). */
export const DEDUPE_MS = 4_000;

/** A dedupe gate: true when `key` may show now. Keys older than the window are forgotten. */
export function createDedupe(windowMs = DEDUPE_MS) {
  const seen = new Map<string, number>();
  return (key: string, now: number) => {
    for (const [k, at] of seen) if (now - at >= windowMs) seen.delete(k);
    if (seen.has(key)) return false;
    seen.set(key, now);
    return true;
  };
}

/** Categories turned off, from what this browser stored (anything malformed counts as none off). */
export function parseOff(raw: string | null): Set<ToastCategory> {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    const ids = new Set(TOAST_CATEGORIES.map((c) => c.id));
    return new Set(
      Array.isArray(v)
        ? (v.filter((x) => ids.has(x as ToastCategory)) as ToastCategory[])
        : [],
    );
  } catch {
    return new Set();
  }
}

// ---- Dispatch state → events (sessions and providers come over SSE as whole objects; these diff them) ----

type SessionLike = {
  id: string;
  name: string;
  role?: string;
  provider?: string;
  parent?: string | null;
  status?: string;
  state?: string;
  startedAt?: number;
  /** The question the session waits on the user for (server `ask`, redacted), and when the state began. */
  ask?: string | null;
  stateSince?: number;
  /** Set on a session that replaced a long one (#969): the old session's name and its token count in millions. */
  rotatedFrom?: { id?: string; name: string; mtok: number } | null;
};
/** The question a session newly waits on the user for, or null. */
const askOf = (s: SessionLike) =>
  s.state === "waiting" && s.ask ? s.ask : null;
type ProviderLike = {
  name?: string;
  connected?: boolean;
  error?: string | null;
};

/** A session counts as new only when it started this recently (a reconnect re-sends older ones). */
export const FRESH_MS = 60_000;
const ended = (s: SessionLike) => s.status === "done" || s.state === "done";
const failed = (s: SessionLike) => s.status === "error" || s.state === "failed";

/** Events between the last known copy of a session (undefined: not seen before) and the new one. */
export function sessionEvents(
  prev: SessionLike | undefined,
  next: SessionLike,
  now: number,
): AppEvent[] {
  // Who it is: role and provider ids only.
  const who = {
    id: next.id,
    name: next.name,
    ...(next.role ? { role: next.role } : {}),
    ...(next.provider ? { provider: next.provider } : {}),
  };
  if (!prev) {
    if (next.startedAt === undefined || now - next.startedAt > FRESH_MS)
      return [];
    if (next.rotatedFrom)
      return [
        {
          type: "session-rotated",
          ...who,
          from: next.rotatedFrom.name,
          mtok: next.rotatedFrom.mtok,
        },
      ];
    return [
      {
        type: "session-started",
        ...who,
        team: next.role === "lead" && !next.parent,
      },
    ];
  }
  if (failed(next) && !failed(prev)) return [{ type: "session-error", ...who }];
  if (ended(next) && !ended(prev)) return [{ type: "session-ended", ...who }];
  const ask = askOf(next);
  if (ask && ask !== askOf(prev))
    return [
      {
        type: "session-asks",
        ...who,
        ask,
        ...(next.stateSince ? { since: next.stateSince } : {}),
      },
    ];
  return [];
}

/** Events between two provider maps (connected flipped, or a new error). */
export function providerEvents(
  prev: Record<string, ProviderLike>,
  next: Record<string, ProviderLike>,
): AppEvent[] {
  const out: AppEvent[] = [];
  for (const [id, p] of Object.entries(next)) {
    const was = prev[id];
    if (!was) continue;
    const name = p.name || id;
    if (p.connected && !was.connected)
      out.push({ type: "model-connected", provider: id, name });
    else if (!p.connected && was.connected)
      out.push({ type: "model-disconnected", provider: id, name });
    else if (p.error && p.error !== was.error)
      out.push({ type: "model-error", provider: id, name });
  }
  return out;
}

type RunLike = {
  file: string;
  runId: string;
  run?: { state?: string; startedAt?: number | null; endedAt?: number | null };
  session?: {
    sid: string;
    pr?: { number: number; state: string | null } | null;
  };
};

/** A run first seen running counts as started here only when it started this close to (or after) the page opened. */
export const RUN_START_SLACK_MS = 5_000;

/**
 * What one `run` SSE event means, given what this page saw of that run before (`seen`: runId → state). `since`: when
 * the page started watching. A run first seen mid-way (it started before the page opened and was paused and resumed,
 * or just reported a step) is only remembered: it says nothing until it ends.
 */
export function runEvents(
  seen: Map<string, string>,
  prs: Map<string, string>,
  e: RunLike,
  since = -Infinity,
): AppEvent[] {
  const out: AppEvent[] = [];
  const st = e.run?.state;
  if (st) {
    const was = seen.get(e.runId);
    seen.set(e.runId, st);
    const live = st === "running" || st === "paused";
    const at = e.run?.startedAt;
    const fresh = typeof at === "number" && at >= since - RUN_START_SLACK_MS;
    if (st === "running" && was === undefined && fresh && !e.run?.endedAt)
      out.push({ type: "run-started", file: e.file, runId: e.runId });
    else if (
      !live &&
      was !== undefined &&
      (was === "running" || was === "paused")
    )
      out.push({
        type: "run-ended",
        file: e.file,
        runId: e.runId,
        failed: st === "failed" || st === "error",
      });
  }
  const pr = e.session?.pr;
  if (pr && pr.state) {
    const k = String(pr.number);
    const was = prs.get(k);
    prs.set(k, pr.state);
    if (was !== undefined && was !== pr.state)
      out.push({
        type: "pr",
        file: e.file,
        number: pr.number,
        state: pr.state,
      });
  }
  return out;
}
