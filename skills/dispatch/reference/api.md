# Dispatch HTTP API

Base URL `http://127.0.0.1:4317` (or `$DISPATCH_PORT`). JSON in and out. Every non-GET request needs the header `x-dispatch: 1`; without it the server answers 403. Errors come back as `{ "error": "<message>" }` with a 4xx status — relay the message to the user as-is.

```bash
H=(-H 'content-type: application/json' -H 'x-dispatch: 1')
```

## Read

| Request | Returns |
|---|---|
| `GET /api/state` | `project`, `roles`, `perms`, `models`, `providers`, `limits`, `settings`, `sessions`. `limits` (Claude windows) is shared by every server on this machine. |
| `GET /api/sessions/<id>/messages` | `{ session, messages }` — the last 400 transcript entries, kept across server restarts (kinds: `user`, `assistant`, `tool`, `tool_result`, `perm`, `error`, `system`) |
| `GET /api/sessions/<id>/diff` | `{ files, add, del, untracked, patch }` for the session's worktree |
| `GET /api/usage` | `{ days }` — last 14 days of cost and tokens per model and role. `days[].sessions` maps a session id to `{ name, role, cost }` spent that day (Claude sessions; days recorded before this field existed omit it) |
| `GET /api/projects` | `{ projects: [{ port, name, path, current }] }` — Dispatch servers running on this machine, one per project. Each server registers itself in `~/.dispatch/servers/<port>.json`; older servers on ports 4317–4330 are found by probing. The UI's project selector switches by opening the chosen port. |
| `GET /api/events` | Server-sent events: `snapshot`, `session`, `message`, `limits`, `providers`, `settings`, `removed`. `limits` also fires when another Dispatch server on this machine wrote newer limits to `~/.dispatch/limits.json`. |

A session object carries `id`, `name`, `role`, `provider`, `model`, `effort`, `perm`, `status` (`starting` · `running` · `waiting` · `idle` · `done` · `error`), `branch`, `cwd`, `parent`, `last` (its own latest answer, not messages sent to it), `stall` (team watchdog warning or null), `stuck` (per-session stuck flag or null, below), `interrupted` (cut off by a restart, resumed on start), `turns`, `usage`, `cost`, `ctx`, `ctxWindow`, `pending` (permission requests).

Monitoring fields, decided on the server so every view agrees:

- `state` — what the session needs from a person: `working` (a turn is running) · `waiting` (a permission prompt is open, or a session without a lead ended its turn asking the user something) · `stuck` (`stuck` is set; see below) · `failed` (last turn ended in an error) · `resting` (turn finished, nothing asked) · `done`. A teammate's question goes to its lead, so it stays `resting`.
- `asksUser` — true when the last turn ended by asking its reader something (checked on the final answer's last lines). With no `parent` this is what makes `state` `waiting`; the web UI then pins the question as a '답할 것' card in the session sheet, read from the transcript in the browser — the question text itself is not stored.
- `stateSince` — epoch ms when the session entered its current `state`.
- `attention` — `{ level: "bad" | "warn", reason, since }` for `failed`, `waiting` and `stuck`; `null` otherwise. For `stuck`, `reason` is `stuck.label` and `since` is `stuck.sinceMs`.
- `burn` — `{ perHour, windowMin }`: dollars per hour over the last 30 minutes (`windowMin` is the span actually measured, shorter for a young session or after a server restart). `perHour` is `null` for the first 5 minutes; `burn` is `null` for sessions that report no cost (Codex, Gemini). The server recomputes it every minute and sends a `session` event when it changed, so an idle session decays to 0 without any activity of its own.
- `burnWarn` — `null`, or `{ reasons, advice, … }` when spending needs a look. `reasons` holds `spike` (≥ 3× the median $/h of the project's sessions, and at least $1/h; adds `ratio`, `medianPerHour`) and/or `longLived` (context ≥ 60 % and running ≥ 3 hours; adds `ctxShare`, `hours`). `advice` is `swapLead` for a lead session — start a fresh lead and hand over — and `null` otherwise.
- `longRun` — `null`, or `{ mtok, sinceMs }` once the session has processed `handoffMTokens` million tokens in total (input + cache read + cache write + output); `attention` then reads `오래 쓴 세션이에요 (누적 NM 토큰). 새 세션으로 바꿔 주세요` (warn) unless a stronger state or the context guard applies. It stays until the session is removed: replace the session, rotation does not clear it. The lead's `list_sessions` shows `mtok` and `long`.
- `ctxHigh` — `null`, or `{ pct, sinceMs }` once the session's context is at or over the `ctxHandoff` guard; `attention` then reads `컨텍스트를 N% 썼어요` (warn) unless a stronger state applies. Cleared when the session continues in a fresh CLI session.
- `stuck` — `null`, or why the session looks stuck:
  - `{ reason: "repeat-fail", label, count, key, kind, sinceMs }` — the same check command (test, build, lint, typecheck, e2e) failed `count` times in a row (`stuckFails`, default 3). `key` is a 12-hex hash of the normalised command (env assignments and redirections dropped; `cd` steps kept, so another directory is another command); `kind` is the activity label (`e2e 실행`, `단위 테스트`, `빌드`, …). A command whose exit code can't tell pass from fail — a pipe without `set -o pipefail` (`npm test | tail`) or `||` — is not counted and leaves the count as it was. A pass of that command, or of any check of the same `kind`, clears it. Command text and output are never stored.
  - `{ reason: "silent", label, sinceMs }` — `running` with no output or tool event for `stuckSilentMinutes` (default 10). The next event clears it.

  `label` is Korean UI copy (`e2e가 3번 연속 실패했어요`). `sinceMs` is epoch ms (first failure, last event). A `session` event goes out when a flag appears, changes reason or command, or clears; a growing `count` is updated in place and rides on the next event, so one loop is one alert. Checked on every tool result and every 30 s.

When a session with a `parent` finishes a turn, the server sends its last answer to the parent as a message (`[<name>(<role>) 보고 · <branch>]` + the text; names are short random ones such as `Juno` or `Cal`, unique among listed sessions), so an idle lead wakes up without polling. A report that cannot be delivered yet (no parent, or a busy Codex lead) is retried until it lands.

## Create sessions

```bash
curl -s -X POST http://127.0.0.1:4317/api/sessions "${H[@]}" -d '{
  "commonPrompt": "Refactor the refund flow and add tests. Summarise the change when done.",
  "worktree": true,
  "items": [
    { "role": "lead" },
    { "role": "impl", "n": 2, "effort": "high" },
    { "role": "review", "model": "gpt-5.6-luna", "perm": "plan" }
  ]
}'
```

Per item: `role` (required), `n` (copies, default 1), `model`, `effort` (one of the model's `efforts`), `perm` (`manual` · `acceptEdits` · `auto` · `plan`), `prompt` (replaces the role prompt), `task` (replaces `commonPrompt` for this item). Omitted fields use the role defaults. Returns `{ sessions: [...] }`.

## Control a session

| Request | Body | Effect |
|---|---|---|
| `POST /api/sessions/<id>/message` | `{ "text": "..." }` | Sends a follow-up; resumes the CLI session if its process has exited. Codex accepts it only while `idle`. |
| `POST /api/sessions/<id>/to-lead` | `{ "text": "..." }` | Sends a mid-turn message from a teammate to its lead (what the `message_lead` tool calls). |
| `POST /api/sessions/<id>/parent` | `{ "parent": "<lead-id>" \| null }` | Attaches a session to a lead (or detaches it). The lead then receives the session's finished turns as reports and sees it in `list_sessions`. Refused when the target is not a lead or already has 8 open children. |
| `POST /api/sessions/<id>/perm` | `{ "perm": "manual" \| "acceptEdits" \| "auto" \| "plan" }` | Changes the session's permission mode. A live Claude process switches at once; otherwise (and for Codex) the next turn starts in it. The transcript and context stay. |
| `POST /api/sessions/<id>/permission` | `{ "requestId", "behavior": "allow" \| "deny", "always": false }` | Answers a pending Claude permission request from `session.pending`. |
| `POST /api/sessions/<id>/interrupt` | — | Stops the current turn; the session stays open. |
| `POST /api/sessions/<id>/kill` | — | Ends the session (`done`). |
| `POST /api/sessions/clear-done` | — | Removes every finished session (`done` or `error`) the same way. Returns `{ removed }`. |
| `POST /api/sessions/<id>/remove` | — | Removes a session from the list, with its tasks; its worktree too when nothing uncommitted is left (the branch stays). The lead does this through `stop_session` with `remove: true`. |

## Task board

| Request | Body | Effect |
|---|---|---|
| `GET /api/timeline` | — | `{ now, windowMs, sessions }` for the 세션 board's 타임라인 view. `sessions` maps each session id to its state changes `[[at, state], …]` (oldest first; `state` is one of `working` · `waiting` · `stuck` · `failed` · `resting` · `done`) over the last `windowMs` (2 hours), starting with the entry in effect when the window opens. Only times and state codes are kept — at most 200 per session, stored with the session in `.dispatch/state.json` and left out of `GET /api/state` and `session` events. |
| `GET /api/tasks` | — | `{ tasks }`: each lead's board — `id`, `lead`, `title`, `stage` (`plan` · `impl` · `review` · `test` · `merge` · `done` · `blocked`), `owner`, `createdAt`, `stageAt`, `stages` (`[{ stage, at }]`, oldest first: each stage the task entered and when — stage and time only, last 40), `etaAt`, `etaSetAt` (when the eta was last set), `note`, `commit`, `mergeCheck`, `stuck`. Done tasks drop off after six hours. `stuck` is `null`, `{ reason: "stage-mismatch", label, stage, activity, count?, sinceMs }` (stage `plan`/`impl` while the owner session loops on failing tests, or has run tests for `stuckMismatchMinutes`, default 10; `stuckMismatchMinutes: 0` turns off both) or `{ reason: "over-eta", label, stage, etaMinutes, sinceMs }` (elapsed since the eta was set passed `stuckEtaRatio` × the eta, default 1.5; `sinceMs` is when it crossed). The owner is matched by session name. A `tasks` event goes out only when a flag appears, changes or clears. |
| `POST /api/tasks` | `{ "id"?, "lead", "title", "stage"?, "owner"?, "eta_minutes"?, "note"?, "commit"? }` | Creates a task (by `title`) or updates one (by `id`). What the lead's `set_task` tool calls. A new task returns `open`, the lead's other open tasks. `commit` is a branch name or commit hash; `""` clears it. Moving a task with a `commit` to `done` first runs `git merge-base --is-ancestor <commit> <integration branch>` in the project folder (integration branch: `develop`, else `main`/`master`, else the current branch). If that fails the stage stays as it was and `mergeCheck` is `{ ok: false, commit, base, reason, at }`; on success it is `{ ok: true, … }`. Closing without a commit (abandoned work) skips the check: `mergeCheck.ok` is `null`. |
| `POST /api/tasks/<id>/remove` | — | Deletes a task. |
| `GET /api/branches` | — | `{ base, commits, tips }` for the 브랜치 page. `base` is the integration branch (`develop`, else `main`/`master`). `commits` (newest first, at most 80): `hash`, `short`, `parents`, `author`, `at`, `subject`, `merge`. `tips`, one per shown branch (live sessions' `dispatch/*` branches, else the eight most ahead, plus `base`): `branch`, `hash`, `short`, `base`, `active`, `ahead` / `behind` (commits only on the branch / only on `base`), `lastAt` (tip commit time), `state` (`open` · `merged` — on `base` after commits of its own · `empty` — nothing committed; `null` for `base`). |

## Providers and settings

| Request | Body | Effect |
|---|---|---|
| `POST /api/providers/<claude\|openai>/login` | — | Connects in Dispatch. Returns `{ connected: true }` when the CLI was already logged in; otherwise starts the CLI's browser login and `providers.<id>.busy` turns true until it finishes. |
| `POST /api/providers/<id>/cancel` | — | Cancels a running browser login. |
| `POST /api/providers/<id>/logout` | `{ "cli": false }` | Disconnects in Dispatch; `cli: true` also logs the CLI out. |
| `POST /api/providers/openai/key` | `{ "key": "..." }` | Codex API-key login, piped straight to `codex login --with-api-key`. Only for keys the user enters in the UI themselves. |
| `POST /api/providers/refresh` | — | Re-reads CLI login status. |
| `POST /api/settings` | `{ "guard": { "enabled", "five", "seven" }, "team": { … } }` | Limit guard thresholds (0–1) and team settings from the 설정 page: `rotateLead` / `rotateOthers` (turns before a fresh CLI session, 0 = off), `ctxHandoff` (context guard in percent of the window, 0 or 30–95, default 70: a Claude session crossing it mid-turn is told once to commit and wrap up, and any session over it continues in a fresh CLI session at its next message whatever its turn count), `handoffMTokens` (session length guard in million tokens processed, 0 or 2–500, default 15: a teammate's lead is told once to stop it and give the rest to a fresh teammate; a lead is told to hand over, mid-turn when running, else with its next message), `maxChildren` (1–16), `replyStyle`, `shareDeps`, `dropWorktrees` (booleans), `autoRemoveDone` (boolean, default true: a teammate whose report reached its lead and that waits on nothing is stopped and removed after the grace period unless the lead writes to it; leads and errored sessions are never removed) and `autoRemoveGraceSec` (10–3600, default 120), `roleModels` (`{ role: modelId }`, `null` resets), stuck thresholds `stuckFails` (0–20), `stuckSilentMinutes` (0–240), `stuckMismatchMinutes` (0–240), `stuckEtaRatio` (1–10, one decimal); 0 turns a check off. Saved per project; the matching `DISPATCH_*` env vars only seed the defaults. |

## Manager MCP tools

`lead` sessions get an MCP server named `dispatch` (its `list_sessions` / `get_session` include `ctxPct`, the share of the context window in use) with `list_roles`, `create_sessions`, `list_sessions`, `get_session`, `send_message`, `set_task`, `stop_session`. `set_task` returns `merge_check` when it was asked to close a task as done. Every other session gets the same server with one tool, `message_lead`. Sessions it creates have `parent` set to the manager's id. These tools wrap the endpoints above, so the same rules (connected providers, limit guard, 8 open children per manager) apply.
