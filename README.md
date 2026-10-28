# Dispatch

Local web UI for running several role-based Claude Code and Codex sessions side by side in one project.

- Pick roles (관리자, 구현자, 리뷰어, 테스터, 디자이너, 문서화), a model and effort per role, and how many sessions of each.
- Each session runs in its own git worktree (`.dispatch/wt/<role>-<n>`) on a `dispatch/<role>-<n>` branch.
- Live transcript, Claude permission prompts, diff, tokens, cost, context and the 5-hour / weekly usage limits.
- Manager sessions get a Dispatch MCP server and can create, message and stop other sessions.

## Use

```bash
skills/dispatch/scripts/setup.sh            # check / log in to Claude Code and Codex
skills/dispatch/scripts/start.sh "$PWD"     # start for the current project → http://127.0.0.1:4317
skills/dispatch/scripts/stop.sh "$PWD"
```

Dispatch is also a skill: it is linked into `.claude/skills` (Claude Code) and `.agents/skills` (Codex) in this repo. Run `scripts/install-skill.sh` to link it into `~/.claude/skills` and `~/.codex/skills` so it works in any project.

## Develop

```bash
npm run dev                 # server (:4317) + Vite live-reload UI (:5173) in one terminal; Ctrl+C stops both
npm run dev -- ../other     # same, for another project
npm run dev -- --no-web     # server only, serving the last build
npm run build               # builds web/ into public/, which the server serves
```

`scripts/dev.sh` installs `web/` dependencies on first run. Ports can be changed with `DISPATCH_PORT` and `WEB_PORT`.

The server (`server/`) has no npm dependencies. It stores only session metadata and usage totals in `<project>/.dispatch/state.json`; transcripts stay in memory and in each CLI's own history, and login tokens or API keys never pass through it.
