# E505: Fable 5.2 only, sessions grouped by project

> Superseded (issue #587, 2026-11-16): part A (Fable 5.2 only) no longer applies. Claude, OpenAI Codex and Gemini run again as in standalone Dispatch; see CLAUDE.md for the provider and permission-mode rules. Part B (sessions grouped by project) still stands.

User decision (2026-11-15):

1. The agent features merged from Dispatch (pipeline runs, session board, model connection, limits) use one model: `claude-fable-5-2` through the Claude CLI. Roles (lead, impl, review, test, design, docs) stay; every role runs Fable 5.2.
2. The app shows sessions per project, not as one flat list. Session board, connection status, limits and run records are grouped by project, matching the projects-first sidebar and dashboard (E42).

Scope is the Atelier app (`server/dispatch`, `server/pipeline`, `server/runs`, `shared/dispatch`, `web/src`). The `plugin/skills/dispatch*` copies and the separate Dispatch tool our dev team runs on are out of scope.

## A. Fable 5.2 only

### Delete, don't hide

Codex and Gemini code is deleted, not hidden behind a flag:

- CLAUDE.md limits child processes to a fixed list. A hidden provider keeps a spawn path (`startCodex`, `startGemini`, `codex debug models`, reading `~/.codex/sessions`) that nobody tests in the UI but that still runs. Fewer spawn paths means fewer ways to run looser than the chosen mode.
- Hidden code rots: the fake CLIs, the permission matrix and the limit merging would keep needing upkeep for a feature nobody can turn on.
- Git history keeps the code if the decision is ever reversed.

What is kept, so old data still opens:

| Data | Today | After |
|---|---|---|
| `Provider` type | `"claude"\|"openai"\|"gemini"` | `"claude"` for new data; readers accept any string |
| Saved sessions with provider `openai`/`gemini` | resume falls into `startCodex` | shown read-only with their old model label. On `load` they get `interrupted = false`, `status: "done"`, so auto-resume and `resumeTicket` never retry them. `send` refuses with "이 세션은 지원하지 않는 모델이에요" before anything is pushed to the transcript (no spawn) |
| `~/.dispatch/limits.json` `gemini` field (shared with other servers) | merged | not read, but kept untouched on write |
| `team.roleModels` overrides naming removed models | `create` fails | ignored; the role runs Fable 5.2 |
| Plan step `model` naming another model | 시작하기 blocked ("모델을 몰라요") | plan opens and shows the old name; 시작하기 runs that step on Fable 5.2 and the step shows "Fable 5.2로 실행해요" (see `hub.create` normalisation below) |
| 복제해서 새 계획 | copies the model | writes `claude-fable-5-2` |
| Run records | raw model string | unchanged (records are history) |

### Server and shared (E505a)

- `models.js`: the list is `[{ id: "claude-fable-5-2", label: "Fable 5.2", provider: "claude" }]`. `GEMINI_MODELS`, `codexModels`, the lazy Codex load go.
- `roles.js`: every role defaults to `claude-fable-5-2`.
- `settings.js`: `patchTeam` only accepts `claude-fable-5-2`; `effectiveRoles` drops overrides for other models.
- `cli.js`: `AGENT_CLIS = ["claude"]`. `auth.js`, `routes.js`: only `claude` login/logout/status.
- `hub.js`: `checkPerm` loses the Gemini table (modes stay manual, acceptEdits, auto, plan; no bypassPermissions). `start` only starts Claude; any other provider throws the unsupported error before spawning (defence in depth; `load`/`send` above stop it earlier). `hub.create` maps any model that is not `claude-fable-5-2` (old plan steps, old role overrides, a lead passing an old id) to `claude-fable-5-2` instead of refusing, and records the requested id nowhere but the plan. `startCodex`, `onCodex`, `startGemini`, `onGemini`, `setGeminiQuota` go. `providerLimits()` returns `{ claude, fable }`.
- `limits.js`: `codexLimits`, `cleanGemini`, `setGemini` go; `load` tolerates and preserves unknown keys. Guards keep their defaults and get stricter, never looser: `guardCheck` (session create and the pipeline pre-start check) and `limitHit` (pause + ticket, `hub.js` ~771) all check `five`, `seven` and `fable`. `fable` uses the `g.seven` threshold, as `attention.ts:118` already does; its ticket key includes `fable:${fableReset}`.
- `server/pipeline/index.js`: unknown or old models are no longer a blocker; the step is started with `claude-fable-5-2`. `PROVIDER_NAMES` keeps only Claude. `duplicate` rewrites models.
- `server/cursor/index.js`: Codex tool-entry parsing goes.
- `mcp.js`: `list_roles` lists one model; `create_sessions.model` is optional and any value runs as Fable 5.2 (via `hub.create`). `write_plan` writes `claude-fable-5-2` for every step. `SPAWN_PROMPT` (`roles.js`) and the pipeline approval message (`index.js` ~362) say the model is always `claude-fable-5-2`.
- `shared/dispatch/types.ts`: `Provider = "claude"`; types that read stored data use `string`.
- Tests: `test/fixtures/fake-cli/codex.mjs`, `agy.mjs` and the codex/agy scenarios in `fake.mjs` go; unit tests that use haiku/sonnet/opus as the session model switch to `claude-fable-5-2`. New tests: old-provider session refuses without spawning, old plan model runs as Fable, old `roleModels` ignored, `limits.json` with a `gemini` key round-trips.

### Web (E505b)

- Model connection (sidebar `SidebarModels`, settings 모델 연결): one row, "Claude · Fable 5.2", with connect/disconnect and the five-hour and Fable weekly windows. Codex and Gemini rows, their API calls and palette keywords go.
- `parts.tsx` `ModelTag` keeps showing unknown providers/models as their raw names (old sessions).
- `UsagePage`: Codex no-cost branch and copy go.
- E2E: `model-row`, `app-sidebar`, `dispatch-usage` assert the single row.

## B. Sessions per project

"Project" means the web app's project: a top-level folder of the workspace (`server/workspace/projects.js`). Files at the root are 미분류. It is identified by its folder `path`, never by the `.project.json` display `name`.

Server Dispatch already uses "project" for the git project (`/api/projects`, `clearAll`). To keep the two apart, the new session field and query parameter are called `folder`; the UI still says 프로젝트.

### Server (E505c)

- Every session gets a `folder` field (top folder path or `null`), stored in `.dispatch/state.json`:
  - pipeline step sessions and pipeline leads: the top folder of the plan path;
  - sessions made by another session (MCP `create_sessions`): inherit the parent's `folder`;
  - MCP `create_sessions` and `POST /api/sessions` accept an optional `folder` (must be an existing top folder, else 400);
  - old sessions without the field: derived from `pipelines[path].links` when the session is still linked (links reset per run, so this is best effort), else `null` (미분류).
  - renaming or moving a top folder does not rewrite sessions: they show under 미분류 afterwards. Updating them on move is a backlog item.
- Lead-written plans (`mcp.js` `write_plan` default `pipelines/<title>`) go into the lead's project folder when it has one.
- `GET /api/runs/list?folder=<path>`: run records (metadata only) for files under that folder, newest first, capped (e.g. 50). Records already live at `.drawing/runs/<file path>/`.
- `GET /api/usage?folder=<path>`: cost and tokens of that project's sessions.
- Connection and the five-hour/weekly limits are per account, not per project. The API stays global; the UI shows them inside the project view (see below) and never pretends they are per-project.

### Web (E505d)

- Session board (`/dispatch`): a project list on the left (from `/api/workspace/projects` plus 미분류, each with its running-session count). Picking a project shows only its sessions, timeline and tasks; "전체" stays as the first entry. The selection is in the URL (`#folder=<path>`), so links from Home open it.
- Project home (`home/Home.tsx` `ProjectHome`): a 세션 block (running and recent sessions, link to the board filtered to this project) and a 실행 기록 block (from `/api/runs/list`).
- Project usage: the project view shows that project's cost and tokens, and the account-wide connection and limits once, labelled 계정 전체.
- `ShellHome.tsx` is dead code; delete it in this ticket.

## Order and parallelism

1. E505a and E505c run in parallel (both touch `hub.js`; a deletes provider paths, c adds the `project` field near `create`; whichever merges second runs `git merge origin/develop`).
2. E505b after E505a merges (it needs the new limits shape).
3. E505d after E505c merges; it follows E505b if both touch `SidebarModels.tsx`/`api.ts`.

Web PRs: full headless e2e (0 skipped) before merge; `npm run build` whenever `web/` or `shared/` changes.

## Docs and rules

- `CLAUDE.md`: "the user's own CLIs (claude, codex, agy)" becomes "the user's own Claude CLI (`claude`)", and child processes are limited to `claude`, `git` and `gh`. Done in E505a.
- `docs/design/dispatch-integration*.md` and `6-app-shell-projects.md`: mark the Codex/Gemini parts as superseded by this file (one line each), done in E505a/E505b.

### Manual real-CLI run rule (approved 2026-11-15, applied to CLAUDE.md in E505a)

Today: "A manual run against a real CLI uses claude-haiku-5-5 at effort low with one-line prompts." After E505 the app can only start `claude-fable-5-2`, so a haiku run no longer exercises the real path.

Rule: "A manual run against the real CLI uses claude-fable-5-2 at effort low, one session at a time, with one-line prompts, and only when a ticket needs it (provider connect, spawn or resume changes). npm test keeps using test/fixtures/fake-cli/ and never starts a real claude."

Fable costs more per token than haiku, hence "one session at a time" and "only when a ticket needs it".
