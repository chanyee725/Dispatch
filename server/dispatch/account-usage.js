import os from "node:os";
import { runCli, spawnCli } from "./cli.js";
import { onJsonLines } from "./hub-util.js";
import { GEMINI_USAGE_MS, geminiUsageResult } from "./limits.js";

const empty = status => ({ status, windows: [] });
const finite = value => typeof value === "number" && Number.isFinite(value);
const timestamp = value => finite(value) && value > 0 && value <= 8.64e15 ? value : null;

function period(minutes) {
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return null;
  if (minutes === 10080) return "주간";
  if (minutes % 1440 === 0) return `${minutes / 1440}일`;
  if (minutes % 60 === 0) return `${minutes / 60}시간`;
  return `${minutes}분`;
}

function codexWindows(result) {
  const limits = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  if (limits == null || (limits.limitId != null && limits.limitId !== "codex")) return empty("unavailable");
  const windows = [limits.primary, limits.secondary].flatMap(window => {
    if (!finite(window?.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100) return [];
    return [{ label: period(window.windowDurationMins), used: window.usedPercent / 100, reset: finite(window.resetsAt) ? timestamp(window.resetsAt * 1000) : null }];
  });
  const status = windows.length === 0 ? "unavailable"
    : windows.length < 2 || windows.some(window => window.label == null || window.reset == null) ? "partial" : "available";
  return { status, windows };
}

/** Reads the signed-in account's quota via read-only RPC. No thread, model turn or rollout is needed. */
export async function codexAccountUsage(spawn = spawnCli) {
  let proc;
  try {
    proc = spawn("codex", ["app-server", "--listen", "stdio://", "-c", 'sandbox_mode="read-only"'], {
      cwd: os.tmpdir(), stdio: ["pipe", "pipe", "ignore"],
    });
    return await new Promise(resolve => {
      let expected = 1;
      const finish = value => { clearTimeout(timer); resolve(value); };
      const fail = () => finish(empty("error"));
      const timer = setTimeout(fail, 15_000);
      const send = message => proc.stdin.write(JSON.stringify(message) + "\n");
      proc.once("error", fail);
      proc.once("close", fail);
      proc.stdin.on("error", fail);
      onJsonLines(proc.stdout, msg => {
        if (msg?.id !== expected || msg.method) return;
        expected++;
        if (msg.error) {
          return finish(empty(msg.id === 2 && msg.error.code === -32601 ? "unavailable" : "error"));
        }
        if (msg.id === 2) return finish(codexWindows(msg.result));
        send({ method: "initialized" });
        send({ id: 2, method: "account/rateLimits/read" });
      });
      send({ id: 1, method: "initialize", params: { clientInfo: { name: "dispatch", version: "1.0.0" } } });
    });
  } catch {
    return empty("error");
  } finally {
    proc?.kill();
  }
}

function claudeAccountUsage(limits) {
  const windows = [
    { label: "5시간", used: limits.five, reset: timestamp(limits.fiveReset), observedAt: timestamp(limits.fiveObservedAt) },
    { label: "주간", used: limits.seven, reset: timestamp(limits.sevenReset), observedAt: timestamp(limits.sevenObservedAt) },
    { label: "Fable 주간", used: limits.fable, reset: timestamp(limits.fableReset), observedAt: timestamp(limits.fableObservedAt) },
  ].filter(window => finite(window.used) && window.used >= 0 && window.used <= 1);
  const status = windows.length === 0 ? "empty"
    : windows.filter(window => window.label !== "Fable 주간").length < 2 || windows.some(window => window.reset == null)
      ? "partial" : "available";
  return { status, windows };
}

export async function accountUsage(id, { providers, hub }, { codex = codexAccountUsage, gemini = () => geminiUsageResult(runCli), now = Date.now } = {}) {
  const disconnected = { connection: "disconnected", status: null, windows: [] };
  const provider = providers()[id];
  if (!provider?.connected) return disconnected;
  if (id === "claude") {
    return { connection: "connected", ...claudeAccountUsage(hub.limits), updatedAt: timestamp(hub.limits.updatedAt) };
  }
  if (id === "openai") {
    const usage = provider.method === "API 키" ? empty("unavailable") : await codex();
    if (!providers()[id]?.connected || providers()[id]?.method !== provider.method) return disconnected;
    return { connection: "connected", ...usage, updatedAt: usage.windows.length ? now() : null };
  }
  const { status, windows, updatedAt } = await gemini();
  if (!providers()[id]?.connected) return disconnected;
  const quota = hub.shared?.gemini;
  const reset = timestamp(quota?.reset);
  const observedAt = timestamp(quota?.at);
  const checkedAt = now();
  // Without a reset, a quota signal is current only within the usage polling interval.
  const knownQuota = typeof quota?.reached === "boolean" && (reset != null
    ? reset > checkedAt
    : observedAt != null && checkedAt - observedAt < GEMINI_USAGE_MS);
  // agy --version confirms installation only. A quota response can verify the account connection.
  return {
    connection: windows.length ? "connected" : "unverified", status, windows,
    updatedAt: windows.length ? timestamp(updatedAt) : null,
    ...(knownQuota && { reached: quota.reached, reset }),
  };
}
