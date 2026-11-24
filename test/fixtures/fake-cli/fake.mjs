// Shared body of the fake agent CLIs (claude.mjs, codex.mjs, agy.mjs; gh.mjs has its own). A fake:
// - appends { bin, args, cwd } as one JSON line to $FAKE_CLI_LOG (so a test can prove the fake ran);
// - answers the status commands the server uses (--version, auth status, login status);
// - for a session turn, prints the JSON lines of $FAKE_CLI_SCENARIO (a JSON-lines file) or a short
//   default reply in that CLI's stream format, then exits with $FAKE_CLI_EXIT (default 0).
//   $FAKE_CLI_SCENARIO_<BIN> (e.g. FAKE_CLI_SCENARIO_CLAUDE) takes over for that one CLI.
//   Scenario lines with a $ key are actions, not output: { "$sleep": ms } waits, { "$write": { file, text } } writes
//   `text` to the absolute path `file` (a test's scratch folder), like an agent editing a file, and
//   { "$waitFor": file } waits until that file exists (up to 60 s), so a test can hold the turn until it has
//   seen what it checks instead of racing fixed sleeps. { "$raw": text } prints text as is (no newline added).
// - with $FAKE_CLI_AUTH (a state file path) fakes `auth status|login|logout` (claude) and
//   `login status|login|logout` (codex; `login --with-api-key` reads the key from stdin, keeps only
//   that it got one, and fails on an empty key; `agy install` is agy's login): status reads the file,
//   login prints a fake URL, waits $FAKE_CLI_LOGIN_MS (default 300) and writes the file, or exits with
//   $FAKE_CLI_LOGIN_EXIT without logging in; logout removes the file. Without it, status says logged in and `codex login --with-api-key` succeeds.
//   With $FAKE_CLI_LOGIN_IGNORE_TERM the login ignores SIGTERM (only SIGKILL stops it).
// - codex exec / agy -p take the prompt as an argument (no stdin): one turn, then exit.
// It never talks to the network and never reads credentials.
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const DEFAULT = {
  claude: [
    { type: "system", subtype: "init", session_id: "fake-claude-session" },
    { type: "assistant", message: { id: "fake-msg-1", content: [{ type: "text", text: "fake reply" }], usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: "result", subtype: "success", total_cost_usd: 0.001 },
  ],
  codex: [
    { type: "thread.started", thread_id: "fake-codex-thread" },
    { type: "item.completed", item: { type: "agent_message", text: "fake reply" } },
    { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5 } },
  ],
  agy: [
    { event: "init", conversation_id: "fake-agy-conversation" },
    { event: "step_update", step_update: { step_type: "agent_response", text_delta: "fake reply", usage: { input_tokens: 10, output_tokens: 5 } } },
    { event: "result", result: { status: "OK", response: "fake reply" } },
  ],
};

// `codex debug models`: the catalog shape the server reads (only "list" models are offered).
const CODEX_MODELS = { models: [
  { slug: "gpt-fake-codex", display_name: "GPT Fake Codex", visibility: "list", priority: 1,
    supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }], default_reasoning_level: "medium", context_window: 272000 },
  { slug: "gpt-fake-hidden", display_name: "Hidden", visibility: "hide", priority: 2 },
] };

const STATUS = {
  claude: { "auth status": JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "fake@example.invalid" }) },
  codex: { "login status": "Logged in using ChatGPT", "debug models": JSON.stringify(CODEX_MODELS) },
};

function scenario(bin) {
  const file = process.env[`FAKE_CLI_SCENARIO_${bin.toUpperCase()}`] || process.env.FAKE_CLI_SCENARIO;
  if (!file) return DEFAULT[bin];
  return readFileSync(file, "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
}

async function emit(lines) {
  for (const l of lines) {
    if (l.$sleep) await new Promise(r => setTimeout(r, l.$sleep));
    else if (l.$waitFor) for (let i = 0; i < 3000 && !existsSync(l.$waitFor); i++) await new Promise(r => setTimeout(r, 20));
    else if (l.$write) writeFileSync(l.$write.file, l.$write.text);
    else if (l.$raw != null) process.stdout.write(l.$raw);
    else process.stdout.write(JSON.stringify(l) + "\n");
  }
}
const finish = () => process.exit(Number(process.env.FAKE_CLI_EXIT || 0));

function fakeAuth(file, sub, bin = "claude", rest = []) {
  if (sub === "status") {
    const loggedIn = existsSync(file);
    if (bin === "codex") process.stdout.write(loggedIn ? "Logged in using ChatGPT\n" : "Not logged in\n");
    else process.stdout.write(JSON.stringify(loggedIn ? { loggedIn, authMethod: "claude.ai", email: "fake@example.invalid" } : { loggedIn }) + "\n");
    return process.exit(0);
  }
  if (sub === "login" && rest[0] === "--with-api-key") {
    // The key arrives on stdin; the fake keeps only the fact that one came (never the key itself).
    let key = "";
    process.stdin.on("data", d => { key += d; });
    process.stdin.on("end", () => {
      if (!key.trim()) { process.stderr.write("Error: no API key on stdin\n"); return process.exit(1); }
      writeFileSync(file, "fake-key-login\n");
      process.exit(0);
    });
    return;
  }
  if (sub === "logout") { rmSync(file, { force: true }); return process.exit(0); }
  if (sub === "login") {
    if (process.env.FAKE_CLI_LOGIN_IGNORE_TERM) process.on("SIGTERM", () => {});
    process.stdout.write("Open this URL to log in: https://login.example.invalid/oauth?fake=1\n");
    setTimeout(() => {
      if (process.env.FAKE_CLI_LOGIN_EXIT) return process.exit(Number(process.env.FAKE_CLI_LOGIN_EXIT));
      writeFileSync(file, "fake\n");
      process.exit(0);
    }, Number(process.env.FAKE_CLI_LOGIN_MS || 300));
    return;
  }
  process.exit(1);
}

export function run(bin) {
  const args = process.argv.slice(2);
  if (process.env.FAKE_CLI_LOG) appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ bin, args, cwd: process.cwd() }) + "\n");
  if (args[0] === "--version") { process.stdout.write(`${bin} 0.0.0-fake\n`); return finish(); }
  const cmd = args.slice(0, 2).join(" ");
  const auth = process.env.FAKE_CLI_AUTH;
  if (auth && bin === "claude" && args[0] === "auth") return fakeAuth(auth, args[1]);
  if (auth && bin === "codex" && args[0] === "login") return fakeAuth(auth, args[1] === "status" ? "status" : "login", "codex", args.slice(1));
  if (auth && bin === "codex" && args[0] === "logout") return fakeAuth(auth, "logout", "codex");
  if (auth && bin === "agy" && args[0] === "install") return fakeAuth(auth, "login", "agy");
  // Without $FAKE_CLI_AUTH an API-key login just succeeds (reads the key, keeps nothing) instead of playing the
  // exec scenario, whose $waitFor gates would hold the login for minutes.
  if (bin === "codex" && cmd === "login --with-api-key") { process.stdin.resume(); process.stdin.on("end", finish); return; }
  const status = STATUS[bin]?.[cmd];
  if (status !== undefined) { process.stdout.write(status + "\n"); return finish(); }

  // codex exec / agy -p: the prompt is an argument and stdin is closed. One turn, then exit.
  if (bin === "codex" || bin === "agy") return emit(scenario(bin)).then(finish);

  // claude -p --input-format stream-json: one turn per user line on stdin, alive until stdin ends.
  // Turns are played one after another, so a scenario's $sleep holds back the next turn's lines too.
  let first = true;
  let turns = Promise.resolve();
  const rl = createInterface({ input: process.stdin });
  rl.on("line", line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type !== "user") return;
    const lines = first ? scenario(bin) : DEFAULT.claude.slice(1);
    first = false;
    turns = turns.then(() => emit(lines));
  });
  rl.on("close", () => turns.then(finish));
}
