# User defaults: `~/.dispatch/drawing.json`

Issue #724 (E555). One human-editable file holds the user's defaults for every Atelier server on this
computer. CLAUDE.md already lets the server write under `~/.dispatch/`, so the file lives there.

## What goes in it

Metadata only: no tokens, API keys, emails, names or transcripts.

```json
{
  "version": 1,
  "theme": "dark",
  "workspace": "~/docs/drawing",
  "port": 4330,
  "prStatus": true,
  "team": { "rotateLead": 2, "replyStyle": true, "roleModels": { "lead": "claude-sonnet-5-5" } },
  "guard": { "five": 0.9, "seven": 0.95, "openai": { "five": 0.9 } },
  "workspaces": [{ "path": "~/docs/drawing", "name": "drawing" }],
  "lastWorkspace": "~/docs/drawing"
}
```

| Key | Type | Used for |
| --- | --- | --- |
| `version` | integer | Schema version, written as `1` on the first save. |
| `theme` | `"system"`, `"light"`, `"dark"` | UI theme. The browser's localStorage copy paints the first frame; the file wins once it answers. |
| `workspace` | path (absolute or `~/…`) | Folder `npm start` opens when the command line names none. |
| `port` | integer 1–65535 (UI: 1024–65535) | Port `npm start` binds when `DRAW_PORT` is not set. |
| `prStatus` | boolean | PR tracking default for workspaces that have no value of their own. |
| `team` | object | Team settings from 설정 (rotate, caps, auto-remove, stall checks, `roleModels`). |
| `guard` | object | Usage-guard thresholds (`five`, `seven`, `fable`, `openai.five`, `openai.seven`; 0 < x ≤ 1). `enabled` stays per project. |
| `accountLabels` | object `{ claude?, openai?, gemini? }` | The user's name for each provider connection (#747), e.g. `Claude · Max`. At most 40 characters; values with `@`, control characters, 6+ digit runs, 16+ hex runs, UUIDs or key prefixes are refused (never an email or account id). Unset: the provider name. |
| `workspaces` | array of `{ path, name }` | Registered workspace folders (see below). |
| `lastWorkspace` | path | The workspace opened last (see below). |
| `modeProfiles` | object | Harness profiles per mode × role (#748): `cells.<mode>.<role> = { provider, model, effort, perm }` and `hints.<model id or provider>` (≤ 40 chars). Only changed cells are stored; built-in grid in `server/dispatch/mode-profiles.js`. |

## Format rules

- Keys are written in the order above, unknown keys after them in the order the file had them. Unknown keys are
  never dropped, so a newer or older Atelier, or a hand edit, survives a save.
- 2-space indent and a trailing newline; written atomically (temp file + rename), mode 0600, folder 0700.
- A value with the wrong type is skipped on read and named in `problems` (GET /api/user-defaults); the other
  values still apply. The bad value stays in the file until the user fixes it or saves that key again.
- A broken file (not JSON, not an object, unreadable) never crashes the server: it reads as "no defaults", the
  server logs one line, 설정 > 일반 shows the error, and every write refuses with 409 so the user's file is
  never overwritten. Fix or delete the file, then 다시 읽기.
- `DRAWING_USER_DEFAULTS=off` turns the file off completely (nothing read or written). `npm test` sets it in
  `test/test-env`; `test/user-defaults.test.js` uses a temp HOME. Tests never touch the real `~/.dispatch`.

## Read order

Each value is looked up key by key; the first place that has a valid value wins.

| Value | 1st | 2nd | 3rd | Last |
| --- | --- | --- | --- | --- |
| Theme | `drawing.json` `theme` | — | — | `system` |
| Team settings, guard thresholds | `drawing.json` `team` / `guard` | project `state.json` `settings` | — | built-in defaults |
| Workspace for `npm start` | command-line folder | `drawing.json` `workspace` | `drawing.json` `lastWorkspace` | error with usage |
| Port | `DRAW_PORT` | `drawing.json` `port` | — | 4330 |
| PR tracking | `<workspace>/.drawing/settings.json` `prStatus` | `drawing.json` `prStatus` | — | on |

PR tracking is the one value where the workspace wins over the user's file: CLAUDE.md lets PR tracking be turned
off per workspace, so a workspace's own switch must not be overridden by a computer-wide default. `drawing.json`
`prStatus` only fills in for workspaces that never set it.

## Writes

- 설정 > 일반 > 기본값 saves `workspace`, `port` and `prStatus` through `POST /api/user-defaults`
  (`x-drawing: 1`; `null` removes a key). The theme switch saves `theme` the same way. 모델 연결 saves
  `accountLabels` as a partial patch: `{ accountLabels: { openai: "Codex · 팀 계정", gemini: null } }` changes only
  the named providers (`null` or `""` clears one). A new session copies its provider's label as it is then.
- Team and guard sections save through `POST /api/settings` as before; the server writes the change to
  `drawing.json` first and to the project's `state.json` after. If the file is broken the save is refused and
  `state.json` is left as it was, so the two never disagree.
- `workspace` and `port` take effect on the next `npm start`.

## `workspaces` and `lastWorkspace`

These two keys are reserved for the workspace picker (issue #721, PR #723):

- `workspaces` lists the folders the user registered, as `{ path, name }` (path absolute or `~/…`, name shown in
  the picker, defaulting to the folder name). The picker adds and removes entries; nothing else writes it.
- `lastWorkspace` is the folder opened last. The picker updates it when the user switches folders.
- `npm start` with no folder uses `workspace` if set, else `lastWorkspace`. So a user who never sets a default
  reopens the folder they used last.
- The server reads both today (`readValues` keeps valid entries and drops malformed ones) but does not write them
  yet; `POST /api/user-defaults` does not accept them. #723 adds the writes through `UserDefaults.update`.

## Related code

- `server/user-defaults.js`: `UserDefaults` (load, status, update), `readDefaultsSync`, `startDefaults`,
  `checkPatch`, routes `GET`/`POST /api/user-defaults`.
- `server/index.js`, `server/cli.js`: `npm start` workspace and port defaults.
- `server/dispatch/index.js`: `saveUserDefaults` for team and guard.
- `server/dispatch/routes.js`: `POST /api/settings` writes `drawing.json` before `state.json`.
- `server/dispatch/pr-status.js`: `prTrackingEnabled(workspaceDir, fallback)`; `server/workspace/index.js`
  `GET /api/workspace/pr-tracking`.
- `web/src/userDefaultsTheme.ts`: theme sync; `web/src/settings/sections/UserDefaultsForm.tsx` and
  `userDefaultsForm.ts`: the 기본값 form.
- Tests: `test/user-defaults.test.js`, `test/web/settings-user-defaults-form.test.ts`.
