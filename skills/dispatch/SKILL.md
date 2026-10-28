---
name: dispatch
description: Set up (log in to Claude Code / Codex) and start the Dispatch web UI for the current project and run several role-based Claude Code / Codex sessions in parallel (manager, implementer, reviewer, tester, designer, docs). Use when the user wants to open Dispatch, fan work out to multiple agent sessions, check what those sessions are doing, or see session cost, context and usage limits.
---

# Dispatch

Dispatch is a local web UI (http://127.0.0.1:4317 by default) that spawns `claude` and `codex` CLI sessions inside the project it was started from. Each session gets a role prompt, a model, a permission mode and (by default) its own git worktree under `.dispatch/wt/`.

## Setup (login)

Run this first when the user asks to set Dispatch up, or when `/api/state` shows a provider with `connected: false`:

```bash
<skill-dir>/scripts/setup.sh --status          # what is installed / logged in
<skill-dir>/scripts/setup.sh claude codex      # log in to the ones that are not (skips the rest)
```

Ask the user which providers they want (Claude, Codex/GPT, or both) and pass only those. Login opens a browser OAuth page through each CLI, so it needs the user's terminal: tell them to run it themselves with `! <skill-dir>/scripts/setup.sh <provider>` instead of running it in a background shell. Never ask the user to paste tokens or keys into the chat.

## Start or reuse the server

Run `scripts/start.sh` from this skill directory with the project root as the argument:

```bash
<skill-dir>/scripts/start.sh "$PWD"
```

It prints the URL when the server is ready, reuses a server that is already serving the same project, and writes logs to `<project>/.dispatch/server.log`. Set `DISPATCH_PORT` to run a second project at the same time. Tell the user the URL; do not open a browser unless they ask.

Stop it with `scripts/stop.sh "$PWD"`.

## Drive sessions from the terminal

Every write request needs the header `x-dispatch: 1`.

```bash
# state: project, roles, models, provider login status, usage limits, sessions
curl -s http://127.0.0.1:4317/api/state

# create sessions: one item per role; n = how many copies
curl -s -X POST http://127.0.0.1:4317/api/sessions \
  -H 'content-type: application/json' -H 'x-dispatch: 1' \
  -d '{"commonPrompt":"<task>","worktree":true,"items":[{"role":"impl","n":2},{"role":"review","model":"gpt-5.6-luna"}]}'

# follow up / inspect
curl -s -X POST http://127.0.0.1:4317/api/sessions/<id>/message -H 'content-type: application/json' -H 'x-dispatch: 1' -d '{"text":"..."}'
curl -s http://127.0.0.1:4317/api/sessions/<id>/messages
curl -s http://127.0.0.1:4317/api/sessions/<id>/diff
```

Role ids: `lead` (관리자, can create sessions itself through the Dispatch MCP tools), `impl`, `review`, `test`, `design`, `docs`. Model ids come from `/api/state` → `models`; Claude and Codex models are both listed, and a provider must be logged in (`connected: true`) before its models can be used.

## Things to keep in mind

- Parallel sessions burn the shared usage limit quickly. Check `limits` in `/api/state` before creating many; the server refuses new sessions above the guard threshold.
- Codex sessions report tokens but not cost, and cannot ask for permission mid-run: `manual`/`plan` run read-only, `acceptEdits`/`auto` run with workspace-write.
- Dispatch keeps only metadata and usage totals in `.dispatch/state.json`. Do not copy transcripts, keys or account details anywhere else.
