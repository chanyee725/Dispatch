import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Login itself is delegated to each CLI: it opens the browser OAuth flow and keeps its own credentials.
// Dispatch never reads or stores tokens, keys, or account emails.
const CLI = {
  claude: { bin: "claude", login: ["auth", "login"], logout: ["auth", "logout"], store: "~/.claude" },
  openai: { bin: "codex", login: ["login"], logout: ["logout"], store: "~/.codex" },
};

const state = {
  claude: { busy: false, url: null, error: null },
  openai: { busy: false, url: null, error: null },
};

async function version(bin) {
  try { return (await run(bin, ["--version"], { timeout: 10000 })).stdout.trim().split("\n")[0]; } catch { return null; }
}

async function claudeStatus() {
  try {
    const { stdout } = await run("claude", ["auth", "status"], { timeout: 15000 });
    const s = JSON.parse(stdout);
    const method = !s.loggedIn ? null
      : s.authMethod === "claude.ai" ? "구독 계정 (claude.ai)"
      : s.apiKeySource || s.authMethod === "console" ? "API 키 / Console" : String(s.authMethod);
    return { connected: !!s.loggedIn, method };
  } catch {
    return { connected: false, method: null };
  }
}

async function codexStatus() {
  try {
    const { stdout, stderr } = await run("codex", ["login", "status"], { timeout: 15000 });
    const out = (stdout + stderr).trim();
    const connected = /logged in/i.test(out) && !/not logged in/i.test(out);
    const method = !connected ? null : /chatgpt/i.test(out) ? "ChatGPT 계정" : /api key/i.test(out) ? "API 키" : "로그인됨";
    return { connected, method };
  } catch {
    return { connected: false, method: null };
  }
}

export async function providerStatus() {
  const [cv, ov, cs, os] = await Promise.all([version("claude"), version("codex"), claudeStatus(), codexStatus()]);
  return {
    claude: { name: "Claude", installed: !!cv, cli: cv, ...cs, ...state.claude, store: CLI.claude.store,
              run: "claude -p --output-format stream-json", keySupported: false },
    openai: { name: "OpenAI Codex", installed: !!ov, cli: ov, ...os, ...state.openai, store: CLI.openai.store,
              run: "codex exec --json", keySupported: true },
  };
}

// onDone(ok) fires once the CLI login process exits.
export function login(id, onChange, onDone = () => {}) {
  const cli = CLI[id];
  if (!cli || state[id].busy) return;
  Object.assign(state[id], { busy: true, url: null, error: null });
  onChange();
  const p = spawn(cli.bin, cli.login, { stdio: ["ignore", "pipe", "pipe"] });
  const scan = d => {
    const m = String(d).match(/https:\/\/\S+/);
    if (m && !state[id].url) { state[id].url = m[0]; onChange(); }
  };
  p.stdout.on("data", scan);
  p.stderr.on("data", scan);
  p.on("error", e => { Object.assign(state[id], { busy: false, error: e.message }); onChange(); });
  p.on("exit", code => {
    Object.assign(state[id], { busy: false, url: null, error: code === 0 ? null : `로그인이 끝나지 않았어요 (code ${code})` });
    onDone(code === 0);
    onChange();
  });
  state[id].proc = p;
}

export function cancelLogin(id) {
  state[id]?.proc?.kill("SIGTERM");
}

export async function logout(id) {
  await run(CLI[id].bin, CLI[id].logout, { timeout: 15000 }).catch(() => {});
}

// Codex only: the key goes straight to the CLI's stdin and is never kept in memory beyond this call.
export function loginWithKey(id, key) {
  if (id !== "openai") return Promise.reject(new Error("API 키 로그인은 Codex만 지원해요"));
  return new Promise((resolve, reject) => {
    const p = spawn("codex", ["login", "--with-api-key"], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", d => { err += d; });
    p.on("error", reject);
    p.on("exit", code => code === 0 ? resolve() : reject(new Error(err.trim().slice(0, 200) || `code ${code}`)));
    p.stdin.end(key);
  });
}

// Strip the child-process handle before sending state to the browser.
export function publicStatus(s) {
  const out = {};
  for (const [k, v] of Object.entries(s)) { const { proc, ...rest } = v; out[k] = rest; }
  return out;
}
