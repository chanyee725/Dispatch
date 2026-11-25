import { onJsonLines } from "./hub-util.js";

const count = value => Number.isSafeInteger(value) && value >= 0;

function processed(total) {
  if (!total) return null;
  const { inputTokens, cachedInputTokens, cacheWriteInputTokens = 0, outputTokens } = total;
  if (![inputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens].every(count)
      || cachedInputTokens > inputTokens) return null;
  // Cached reads and writes are subsets of input. Keep the existing usage buckets disjoint.
  const cacheWrite = Math.min(cacheWriteInputTokens, inputTokens - cachedInputTokens);
  return { input: inputTokens - cachedInputTokens - cacheWrite, cacheRead: cachedInputTokens, cacheWrite, output: outputTokens };
}

// One stdio app-server process per Dispatch turn, as with exec. Its token notifications
// carry both the cumulative processing counters and the latest context snapshot.
export function codexTurn(proc, { threadId: resumeId, cwd, model, sandbox, text, effort, active, started, usage, item, finish }) {
  let threadId;
  let turnId;
  let ended = false;
  let expectedReply = 1;
  const seenCompaction = new Set();
  const seenItems = new Set();
  const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  let previousTotal = resumeId ? null : zero;
  const contextsAtTotal = new Set();
  const send = message => {
    if (proc.stdin.writable) proc.stdin.write(JSON.stringify(message) + "\n");
  };
  const request = (id, method, params) => send({ id, method, params });
  const end = (status, error) => {
    ended = true;
    proc.stdin.end();
    finish(status, error || "Codex 턴을 끝내지 못했어요");
  };
  // A process interrupted while writing to stdio can close the pipe before the write flushes.
  proc.stdin.on("error", error => {
    if (active() && !ended && error.code !== "EPIPE") end("failed", error.message);
  });
  onJsonLines(proc.stdout, msg => {
    if (!active() || ended || !msg) return;
    const { id, method, params = {}, result, error } = msg;
    if (method && id != null) {
      // Like exec, this headless runner never grants an interactive approval.
      if (method === "mcpServer/elicitation/request") send({ id, result: { action: "cancel", content: null, _meta: null } });
      else send({ id, error: { code: -32000, message: "Interactive requests are unavailable in Dispatch" } });
      return;
    }
    if (id != null) {
      if (id !== expectedReply) return;
      expectedReply++;
      if (error) return end("failed", error.message);
      if (id === 1) {
        send({ method: "initialized" });
        request(2, resumeId ? "thread/resume" : "thread/start", {
          cwd, model, sandbox, approvalPolicy: "never",
          ...(resumeId && { threadId: resumeId }),
        });
      } else if (id === 2) {
        threadId = result?.thread?.id;
        if (!threadId || (resumeId && threadId !== resumeId)) return end("failed");
        const policy = result.sandbox?.type;
        if (result.approvalPolicy !== "never" || (policy !== "readOnly" && !(sandbox === "workspace-write" && policy === "workspaceWrite"))) {
          return end("failed", "Codex 권한 모드를 확인하지 못했어요");
        }
        started(threadId);
        request(3, "turn/start", { threadId, effort, input: [{ type: "text", text, text_elements: [] }] });
      } else if (id === 3 && !turnId) {
        turnId = result?.turn?.id;
      }
      return;
    }
    if (!threadId || params.threadId !== threadId) return;
    const tokenUsage = method === "thread/tokenUsage/updated" ? params.tokenUsage : null;
    if (!turnId && resumeId && tokenUsage && params.turnId) {
      // Resume replays the saved absolute counters with a previous turn's ID.
      // Use them as the baseline without showing the old context in the new turn.
      previousTotal = processed(tokenUsage.total) ?? previousTotal;
      const last = tokenUsage.last?.totalTokens;
      if (count(last)) contextsAtTotal.add(`${last}/${tokenUsage.modelContextWindow ?? 0}`);
      return;
    }
    if (method === "turn/started") turnId ??= params.turn?.id;
    if (!turnId || (params.turnId ?? params.turn?.id) !== turnId) return;

    const it = params.item;
    if (it?.type === "contextCompaction" && (method === "item/started" || method === "item/completed")) {
      // Codex can send the compacted count before item/completed. Invalidate once,
      // at item/started (or at completion if this CLI omitted the start).
      if (!seenCompaction.has(it.id)) {
        seenCompaction.add(it.id);
        usage(null, null, 0);
      }
    } else if (method === "item/completed" && it?.id && !seenItems.has(it.id)) {
      seenItems.add(it.id);
      item(it);
    }
    if (tokenUsage) {
      const { total, last, modelContextWindow } = tokenUsage;
      const next = processed(total);
      let delta = null;
      if (next) {
        // Without a resume snapshot, only the latest request belongs to the new turn.
        const entries = previousTotal
          ? Object.entries(next).map(([key, value]) => [key, value - previousTotal[key]])
          : Object.entries(processed(last) ?? zero);
        // Rate-limit updates can repeat usage. Older totals must never replace a newer sample.
        if (entries.some(([, value]) => value < 0)) return;
        if (entries.every(([key, value]) => value <= next[key]) && entries.some(([, value]) => value > 0)) {
          delta = Object.fromEntries(entries);
        }
        previousTotal = next;
      }
      if (delta) contextsAtTotal.clear();
      const ctx = count(last?.totalTokens) ? last.totalTokens : null;
      const window = count(modelContextWindow) ? modelContextWindow : 0;
      const signature = `${ctx}/${window}`;
      if (!contextsAtTotal.has(signature)) {
        contextsAtTotal.add(signature);
        usage(delta, ctx, window);
      }
    }
    if (method === "turn/completed") end(params.turn.status, params.turn.error?.message);
  });
  request(1, "initialize", { clientInfo: { name: "dispatch", version: "1.0.0" } });
}
