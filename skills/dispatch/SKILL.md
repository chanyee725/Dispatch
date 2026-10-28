---
name: dispatch
description: Dispatch — local web UI that runs several role-based Claude Code and Codex sessions in parallel in one project. Use when the user wants to set up or open Dispatch, log Claude/Codex in for it, fan a task out to multiple agent sessions (관리자, 구현자, 리뷰어, 테스터, 디자이너, 문서화), check what those sessions are doing, or see session cost, context and usage limits.
---

# Dispatch

Dispatch serves http://127.0.0.1:4317 and spawns `claude` / `codex` CLI sessions inside the **project it was started from**. Each session gets a role prompt, a model, an effort level, a permission mode and its own git worktree at `.dispatch/wt/<role>-<n>` on branch `dispatch/<role>-<n>`. `<skill-dir>` below is the directory containing this file; its scripts resolve symlinks, so they work from any project that links the skill.

## Steps

1. **Check readiness.** Run `<skill-dir>/scripts/setup.sh --status`.
   Done when every provider the user wants shows `logged in`. For a provider that shows `not logged in`, ask the user to run `! <skill-dir>/scripts/setup.sh <claude|codex>` in their own terminal: login opens a browser OAuth page, so it needs their terminal, and any token or key stays with the CLI. For `not installed`, give the install hint the script prints.

2. **Start or reuse the server.** Run `<skill-dir>/scripts/start.sh "<project-root>"`.
   Done when it prints `Dispatch running for <project> → <url>` or `already running`. If it reports the port serves another project, rerun with `DISPATCH_PORT=4318` (or the next free port) and use that port from here on. Logs: `<project>/.dispatch/server.log`.

3. **Connect providers inside Dispatch.** Providers start disconnected even when the CLI is logged in, and Dispatch refuses sessions for a disconnected provider. Read `GET /api/state` → `providers.<claude|openai>.connected`.
   Done when every provider the user named has `connected: true`. Connect exactly the providers the user named, either by pointing them to the first screen of the UI or with `POST /api/providers/<claude|openai>/login` (connects immediately when `cliLoggedIn: true`; otherwise it starts the CLI's browser login on the user's machine).

4. **Hand over or drive.** Give the user the URL. When the user asked you to start work, create the sessions through the API in [reference/api.md](reference/api.md), then report each session's name, model and branch.
   Done when every requested session appears in `GET /api/state` with status `running`, `waiting` or `idle`.

Stop the server with `<skill-dir>/scripts/stop.sh "<project-root>"`.

## Roles

| id | name | default model | permission | notes |
|---|---|---|---|---|
| `lead` | 관리자 | claude-opus-5-5 | auto | Splits work and creates/steers other sessions through the Dispatch MCP tools (max 8 open children). |
| `impl` | 구현자 | claude-opus-5-5 | acceptEdits | Implements in small commits, runs tests. |
| `review` | 리뷰어 | claude-opus-5-5 | plan | Reads only, reports risks in priority order. |
| `test` | 테스터 | claude-sonnet-5-5 | acceptEdits | Adds edge-case tests. |
| `design` | 디자이너 | claude-sonnet-5-5 | acceptEdits | Layout, spacing, colour, accessibility; leaves logic alone. |
| `docs` | 문서화 | claude-haiku-5-5 | acceptEdits | README / CHANGELOG. |

Any role can run on any listed model; model ids come from `GET /api/state` → `models` (Codex models are read live from `codex debug models`).

## Rules that shape what you do

- **Limits.** Claude sessions share the user's 5-hour and weekly limits (`limits.five` / `limits.seven`, 0–1). The server refuses new Claude sessions at or above the guard in `settings.guard` (default 90% / 85%); Codex sessions are not gated by it. Size the fan-out to what the task needs.
- **Permissions.** Claude sessions in `manual` mode wait for the user to approve tools in the UI (status `waiting`). Codex runs non-interactively: `acceptEdits` / `auto` → workspace-write sandbox, `manual` / `plan` → read-only.
- **Cost.** Claude reports USD (an API-price estimate, not a bill on subscriptions); Codex reports tokens only, so its cost is `null`.
- **Privacy.** Dispatch stores only session metadata and usage totals in `<project>/.dispatch/state.json`. Keep transcripts, keys and account details inside Dispatch and the CLIs.
- **Worktrees** need a git repo with at least one commit; otherwise the session runs in the project folder and its transcript says so.
