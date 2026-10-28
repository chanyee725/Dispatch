# Dispatch

Local web UI for running several role-based Claude Code and Codex sessions side by side in one project.

- Pick roles (관리자, 구현자, 리뷰어, 테스터, 디자이너, 문서화) and, per role, a model, effort, permission mode and how many sessions.
- Each session works in its own git worktree (`.dispatch/wt/<role>-<n>`, branch `dispatch/<role>-<n>`), so parallel sessions never overwrite each other.
- Live transcript, Claude permission prompts, diff, tokens, cost, context and the 5-hour / weekly usage limits.
- 관리자 sessions get a Dispatch MCP server and can create, message and stop other sessions themselves.
- Works as a skill in both Claude Code and Codex.

Requires Node.js 20+, git, and the `claude` and/or `codex` CLI.

## Set up (once per machine)

```bash
git clone https://github.com/chanyee725/Dispatch ~/tools/Dispatch
~/tools/Dispatch/scripts/setup.sh
```

`setup.sh` checks the tools, links the skill into `~/.claude/skills` and `~/.codex/skills`, and asks which CLIs to log in. Options:

| Option | Effect |
|---|---|
| `--project <dir>` | Also link the skill into that project (`.claude/skills`, `.agents/skills`). Repeatable. |
| `--login claude,codex` | Log in without asking (`claude`, `codex`, `both`, `none`). |
| `--no-global` | Skip the links in your home directory. |

Re-run it any time; links are refreshed and logged-in CLIs are skipped. The skill links point at this clone, so `git pull` here updates every project.

## Use in a project

From inside the project, ask Claude Code or Codex: **"dispatch 띄워줘"**. Or run it yourself:

```bash
~/tools/Dispatch/skills/dispatch/scripts/start.sh "$PWD"    # → http://127.0.0.1:4317
~/tools/Dispatch/skills/dispatch/scripts/stop.sh "$PWD"
```

1. On the first screen, connect Claude and/or Codex. Dispatch starts with both disconnected even when the CLIs are logged in; connecting reuses the CLI login, or opens the CLI's browser login if there is none. Disconnecting in Dispatch leaves the CLI login alone.
2. **새 세션** → write the shared prompt, add roles, pick model / effort / permission / count → start.
3. Click a session card for its transcript, permission requests, diff and token details.

Notes:

- The project needs at least one commit for worktrees; without one, sessions run in the project folder.
- `.dispatch/` (worktrees, state, logs) is added to the project's `.git/info/exclude`; its `.gitignore` is untouched.
- One server per project. Run another project at the same time with `DISPATCH_PORT=4318 …/start.sh <dir>`.
- **사용량** → "한도 가까우면 막기" stops new Claude sessions above the 5-hour / weekly thresholds you set.

### Sharing with a team

Add Dispatch as a submodule and link the skill so everyone who clones the project gets it:

```bash
git submodule add https://github.com/chanyee725/Dispatch tools/dispatch
mkdir -p .claude/skills .agents/skills
ln -s ../../tools/dispatch/skills/dispatch .claude/skills/dispatch
ln -s ../../tools/dispatch/skills/dispatch .agents/skills/dispatch
```

## Develop

```bash
npm run dev                 # server (:4317) + Vite live-reload UI (:5173) in one terminal; Ctrl+C stops both
npm run dev -- ../other     # same, against another project
npm run dev -- --no-web     # server only, serving the last build
npm run build               # builds web/ into public/
```

`npm run dev` installs `web/` dependencies on first run. Ports: `DISPATCH_PORT`, `WEB_PORT`. The HTTP API is documented in [skills/dispatch/reference/api.md](skills/dispatch/reference/api.md); contributor notes for agents are in [AGENTS.md](AGENTS.md).

## Privacy

The server has no npm dependencies and binds to 127.0.0.1 only. It stores session metadata and usage totals in `<project>/.dispatch/state.json`. Transcripts stay in memory (and in each CLI's own history); tokens, API keys and account emails never pass through Dispatch.
