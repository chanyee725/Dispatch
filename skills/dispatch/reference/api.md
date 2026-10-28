# Dispatch HTTP API

Base URL `http://127.0.0.1:4317` (or `$DISPATCH_PORT`). JSON in and out. Every non-GET request needs the header `x-dispatch: 1`; without it the server answers 403. Errors come back as `{ "error": "<message>" }` with a 4xx status — relay the message to the user as-is.

```bash
H=(-H 'content-type: application/json' -H 'x-dispatch: 1')
```

## Read

| Request | Returns |
|---|---|
| `GET /api/state` | `project`, `roles`, `perms`, `models`, `providers`, `limits`, `settings`, `sessions` |
| `GET /api/sessions/<id>/messages` | `{ session, messages }` — transcript of the current server run (kinds: `user`, `assistant`, `tool`, `tool_result`, `perm`, `error`, `system`) |
| `GET /api/sessions/<id>/diff` | `{ files, add, del, untracked, patch }` for the session's worktree |
| `GET /api/usage` | `{ days }` — last 14 days of cost and tokens per model and role |
| `GET /api/events` | Server-sent events: `snapshot`, `session`, `message`, `limits`, `providers`, `settings`, `removed` |

A session object carries `id`, `name`, `role`, `provider`, `model`, `effort`, `perm`, `status` (`starting` · `running` · `waiting` · `idle` · `done` · `error`), `branch`, `cwd`, `parent`, `last`, `turns`, `usage`, `cost`, `ctx`, `ctxWindow`, `pending` (permission requests).

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
| `POST /api/sessions/<id>/permission` | `{ "requestId", "behavior": "allow" \| "deny", "always": false }` | Answers a pending Claude permission request from `session.pending`. |
| `POST /api/sessions/<id>/interrupt` | — | Stops the current turn; the session stays open. |
| `POST /api/sessions/<id>/kill` | — | Ends the session (`done`). |
| `POST /api/sessions/<id>/remove` | — | Removes a session from the list. |

## Providers and settings

| Request | Body | Effect |
|---|---|---|
| `POST /api/providers/<claude\|openai>/login` | — | Connects in Dispatch. Returns `{ connected: true }` when the CLI was already logged in; otherwise starts the CLI's browser login and `providers.<id>.busy` turns true until it finishes. |
| `POST /api/providers/<id>/cancel` | — | Cancels a running browser login. |
| `POST /api/providers/<id>/logout` | `{ "cli": false }` | Disconnects in Dispatch; `cli: true` also logs the CLI out. |
| `POST /api/providers/openai/key` | `{ "key": "..." }` | Codex API-key login, piped straight to `codex login --with-api-key`. Only for keys the user enters in the UI themselves. |
| `POST /api/providers/refresh` | — | Re-reads CLI login status. |
| `POST /api/settings` | `{ "guard": { "enabled", "five", "seven" } }` | Limit guard thresholds (0–1). |

## Manager MCP tools

`lead` sessions get an MCP server named `dispatch` with `list_roles`, `create_sessions`, `list_sessions`, `get_session`, `send_message`, `stop_session`. Sessions it creates have `parent` set to the manager's id. These tools wrap the endpoints above, so the same rules (connected providers, limit guard, 8 open children per manager) apply.
