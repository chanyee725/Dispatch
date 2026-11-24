---
name: atelier-setup
description: Start Atelier (local agent sessions, teams and chat) in a project, connect Claude, Codex or Gemini to it, check it runs, and stop or restart its server. Use when the user says "아틀리에 켜줘", "Atelier 시작", "Claude 연결", "서버 재시작", or another Atelier skill needs a running server.
---

# Atelier setup

Atelier serves `http://127.0.0.1:<port>` (4330 by default) for one project and runs agent sessions there, each in its own git worktree at `.atelier/worktrees/<role>-<n>`. `<skill-dir>` is this file's folder; `<plugin-root>` is two levels up. The workspace is `<project>/.atelier`, created on start and kept out of git through `.git/info/exclude` when the project does not ignore it yet (an older `<project>/atelier` or `<project>/pipelines` is moved into it on start).

## Steps

1. Install and check the CLIs: `<skill-dir>/scripts/setup.sh --install`. On a fresh checkout it runs `npm ci` and `npm run build` (a minute or two); after that it only prints the status.
   Done when: it exits 0 and each provider the user wants shows `logged in`. For `not logged in`, ask the user to run `! <skill-dir>/scripts/setup.sh <claude|codex>` in their own terminal (browser login; the token stays with the CLI). For `not installed`, relay the hint the script prints. `gh` is needed for issues and PRs: when it is not installed or not logged in, tell the user (installing it needs sudo, so in their own terminal; then `! gh auth login`) and go on.
2. Start or reuse the server: `<plugin-root>/scripts/start.sh "<project-root>"`.
   Done when: it prints the URL. If the port serves another project, rerun with `DISPATCH_PORT=<next free port>` and keep that port. Log: `<project>/.atelier/server.log`.
3. Connect providers. Providers start disconnected. Read `GET /api/state` → `providers.<claude|openai|gemini>.connected`; connect only the ones the user named with `POST /api/providers/<id>/login` (header `x-drawing: 1`).
   Done when: each named provider shows `connected: true`.
4. Give the user the URL.
   Done when: the user has the URL and knows which providers are connected.

## Stop and restart

- Stop: `<skill-dir>/scripts/stop.sh "<project-root>"`.
- Restart (loads new server code): `<skill-dir>/scripts/restart.sh "<project-root>"`. Running turns are cut and resumed with a note; transcripts live in memory only, so they are gone after a restart.

Done when: `GET /api/state` answers again (restart) or the port is free (stop).

## Reference

HTTP endpoints, session fields and MCP tools: [reference/api.md](reference/api.md). Run a team with `atelier-team`, a small change with `atelier-quickfix`, the live board with `atelier-status`.
