# Model connection: server contract (issue #570, E525)

The server side of the model connection, ported from Dispatch's `server/index.js` and `server/auth.js`
(Claude path only). The web side (`web/src/SidebarModels.tsx`, the ported connect dialog) follows this.
Existing route paths are unchanged; nothing here needs a new client call.

Project rules that win over the Dispatch code: one provider (`claude`), one model (`claude-fable-5-2`),
no API-key route or key fields, the server never reads or stores credentials, the CLI runs only through
`server/dispatch/cli.js` (no shell), and nothing starts a CLI before the user connects (not even a
status check).

## Provider object

`providers` is `{ claude: Provider }`. Same fields as Dispatch, minus nothing the UI needs:

```jsonc
{
  "name": "Claude",
  "installed": true,        // null = not checked yet (no CLI was started), false = `claude` not found
  "cli": "2.1.0 (Claude Code)", // `claude --version` first line, or null
  "cliLoggedIn": true,      // the CLI itself is logged in on this machine (`claude auth status`)
  "connected": true,        // cliLoggedIn AND the user connected it in Atelier (kept in .dispatch/state.json)
  "method": "구독 계정 (claude.ai)", // how the CLI is logged in, or null; never an email or account name
  "busy": false,            // a `claude auth login` is running
  "url": null,              // the login URL the CLI printed while busy, else null
  "error": null,            // last login error (Korean, short), else null
  "store": "~/.claude",
  "run": "claude -p --output-format stream-json",
  "keySupported": false     // always false: there is no API-key route
}
```

Before the first connect (and after a server start while not connected) the object is the "not
checked" shape: `{ installed: null, connected: false, cliLoggedIn: false, busy: false, url: null, error: null, method: undefined }`
with no `name`/`cli`. The UI shows 연결 for it; the CLI is checked when the user presses it.

## Reads

- `GET /api/state` → `{ ..., providers, models, ... }`. Also right after a reload: `busy`/`url`/`error`
  of a login still running come back here.
- SSE event `providers` → the whole `providers` object (same shape), sent on every change: login start,
  URL found, login exit, cancel, connect, disconnect, refresh.

## Writes (all need `x-drawing: 1`; body JSON)

| Route | Body | Response | What happens |
|---|---|---|---|
| `POST /api/providers/claude/login` | `{}` | `{ ok: true, connected: true }` | CLI already logged in → connected now (no browser). |
| | | `{ ok: true, connected: false }` | CLI not logged in → `claude auth login` started; watch `providers` for `busy`, `url`, then `connected` (exit 0) or `error`. A second call while busy does nothing. |
| | | `400 { error: "Claude CLI를 찾지 못했어요. 설치한 뒤 다시 눌러 주세요" }` | `claude` not installed; `providers.claude.installed` is `false`. |
| `POST /api/providers/claude/cancel` | `{}` | `{ ok: true }` | Stops a running login. Ends with `busy: false, url: null, error: null` (a cancel is not an error). |
| `POST /api/providers/claude/logout` | `{}` | `{ ok: true }` | Disconnects from Atelier only (`connected: false`); the CLI stays logged in, so 연결 again connects at once. |
| | `{ cli: true }` | `{ ok: true }` | Also runs `claude auth logout`. |
| `POST /api/providers/refresh` | `{}` | `providers` | Re-checks the CLI and broadcasts. |

Errors are `{ error: string }` with a 4xx status. There is no `/api/providers/<id>/key`.

## States (what the row shows)

| `installed` | `busy` | `connected` | Row |
|---|---|---|---|
| `false` | – | – | 설치 안 됨 |
| any | `true` | – | 로그인 중 (+ link to `url` when set, 취소) |
| not false | `false` | `true` | 연결됨 (해제) |
| not false | `false` | `false` | 연결 안 됨 (연결; `error` under it when set) |

## Tests

`test/fixtures/fake-cli/` fakes `claude auth login|logout|status` when `FAKE_CLI_AUTH` names a state
file (see `fake.mjs`): status reads the file, login prints a fake URL, waits `FAKE_CLI_LOGIN_MS`
(default 300) and logs in unless `FAKE_CLI_LOGIN_EXIT` is set, logout removes the file. Without
`FAKE_CLI_AUTH` the fake stays logged in, as before.
