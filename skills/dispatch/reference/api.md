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

A session object carries `id`, `name`, `role`, `provider`, `model`, `effort`, `perm`, `status` (`starting` · `running` · `waiting` · `idle` · `done` · `error`), `branch`, `cwd`, `parent`, `last` (its own latest answer, not messages sent to it), `stall` (watchdog warning or null), `interrupted` (cut off by a restart, resumed on start), `turns`, `usage`, `cost`, `ctx`, `ctxWindow`, `pending` (permission requests).

Monitoring fields, decided on the server so every view agrees:

- `state` — what the session needs from a person: `working` (a turn is running) · `waiting` (a permission prompt is open, or a session without a lead ended its turn asking the user something) · `stuck` (flagged by the per-session stall check) · `failed` (last turn ended in an error) · `resting` (turn finished, nothing asked) · `done`. A teammate's question goes to its lead, so it stays `resting`.
- `asksUser` — true when the last turn ended by asking its reader something (checked on the final answer's last lines). With no `parent` this is what makes `state` `waiting`; the web UI then pins the question as a '답할 것' card in the session sheet, read from the transcript in the browser — the question text itself is not stored.
- `stateSince` — epoch ms when the session entered its current `state`.
- `attention` — `{ level: "bad" | "warn", reason, since }` for `failed`, `waiting` and `stuck`; `null` otherwise.
- `burn` — `{ perHour, windowMin }`: dollars per hour over the last 30 minutes (`windowMin` is the span actually measured, shorter for a young session or after a server restart). `perHour` is `null` for the first 5 minutes; `burn` is `null` for sessions that report no cost (Codex, Gemini). The server recomputes it every minute and sends a `session` event when it changed, so an idle session decays to 0 without any activity of its own.
- `burnWarn` — `null`, or `{ reasons, advice, … }` when spending needs a look. `reasons` holds `spike` (≥ 3× the median $/h of the project's sessions, and at least $1/h; adds `ratio`, `medianPerHour`) and/or `longLived` (context ≥ 60 % and running ≥ 3 hours; adds `ctxShare`, `hours`). `advice` is `swapLead` for a lead session — start a fresh lead and hand over — and `null` otherwise.

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
| `GET /api/tasks` | — | `{ tasks }`: each lead's board — `id`, `lead`, `title`, `stage` (`plan` · `impl` · `review` · `test` · `merge` · `done` · `blocked`), `owner`, `createdAt`, `stageAt`, `stages` (`[{ stage, at }]`, oldest first: each stage the task entered and when — stage and time only, last 40), `etaAt`, `note`, `commit`, `mergeCheck`. Done tasks drop off after six hours. |
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
| `POST /api/settings` | `{ "guard": { "enabled", "five", "seven" }, "team": { … } }` | Limit guard thresholds (0–1) and team settings from the 설정 page: `rotateLead` / `rotateOthers` (turns before a fresh CLI session, 0 = off), `maxChildren` (1–16), `replyStyle`, `shareDeps`, `dropWorktrees` (booleans), `roleModels` (`{ role: modelId }`, `null` resets). Saved per project; the matching `DISPATCH_*` env vars only seed the defaults. |

## Manager MCP tools

`lead` sessions get an MCP server named `dispatch` with `list_roles`, `create_sessions`, `list_sessions`, `get_session`, `send_message`, `set_task`, `stop_session`. `set_task` returns `merge_check` when it was asked to close a task as done. Every other session gets the same server with one tool, `message_lead`. Sessions it creates have `parent` set to the manager's id. These tools wrap the endpoints above, so the same rules (connected providers, limit guard, 8 open children per manager) apply.
