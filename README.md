# Dispatch

Local web UI for running several role-based Claude Code, Codex and Gemini sessions side by side in one project.

![Sessions board](docs/images/sessions.png)

- Pick roles (관리자, 구현자, 리뷰어, 테스터, 디자이너, 문서화) and, per role, a model, effort, permission mode and how many sessions.
- Each session works in its own git worktree (`.dispatch/wt/<role>-<n>`, branch `dispatch/<role>-<n>`), so parallel sessions never overwrite each other.
- 관리자 sessions get a Dispatch MCP server and can create, message and stop other sessions; teammates report back to their lead automatically.
- Live transcript with a CLI-style thinking line (`✻ Untangling… (1m 5s · ↓ 12.3k tokens)`), collapsible tool calls, and coloured `+`/`-` lines for diffs and `git --stat`.
- Long-lived sessions stay cheap: after 5 turns for a lead and 10 for other roles, a session continues in a fresh CLI session with a handoff note (its last answer and, for a lead, its teammates), so the context does not keep growing. `DISPATCH_ROTATE_TURNS_LEAD` / `DISPATCH_ROTATE_TURNS` change the counts, `0` turns it off.
- Every session answers in a short, action-first style (the `i-have-adhd` rules when that Claude Code plugin is installed; `DISPATCH_REPLY_STYLE=off` turns it off).
- Works as a skill in both Claude Code and Codex.

| | |
|---|---|
| ![Changes tab](docs/images/diff.png) **변경사항** — everything the session's branch changed since it left your branch (commits + uncommitted edits), per file with line numbers. | ![Usage](docs/images/usage.png) **사용량** — daily cost stacked by project, per-model and per-role totals, and every Dispatch project running on this machine. |
| ![Per-model breakdown](docs/images/model-breakdown.png) Click **비용** or **토큰** for a per-model breakdown. | ![Dark theme](docs/images/sessions-dark.png) System / light / dark theme, shared by every project. |

### At a glance

- **Top bar:** usage limits per provider — Claude 5-hour and weekly, GPT (Codex) windows, and Gemini's state (Gemini reports no percentage, so it shows OK until a quota error, then the reset time). Hover for reset times.
- **프로젝트 선택:** switch between the Dispatch servers running on this machine (one per project).
- **새 세션** starts sessions; the broom icon next to it stops and removes every session of this project after a confirmation (branches and worktrees stay).
- **사용량 → 한도 가까우면 막기** blocks new Claude sessions above the thresholds you set.

Requires Node.js 20+, git, and at least one of the `claude`, `codex` or `agy` (Antigravity, for Gemini) CLIs.

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

1. On the first screen, connect Claude, Codex and/or Gemini. Dispatch starts with both disconnected even when the CLIs are logged in; connecting reuses the CLI login, or opens the CLI's browser login if there is none. Disconnecting in Dispatch leaves the CLI login alone.
2. **새 세션** → write the shared prompt, add roles, pick model / effort / permission / count → start.
3. Click a session card for its transcript, permission requests, diff and token details.

Notes:

- The project needs at least one commit for worktrees; without one, sessions run in the project folder.
- `.dispatch/` (worktrees, state, logs) is added to the project's `.git/info/exclude`; its `.gitignore` is untouched.
- One server per project. Run another project at the same time with `DISPATCH_PORT=4318 …/start.sh <dir>`; the port is remembered in `.dispatch/server.port`, so `restart.sh` reuses it.

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

The server has no npm dependencies and binds to 127.0.0.1 only. Per project it keeps session metadata and usage totals in `<project>/.dispatch/state.json` and transcripts in `<project>/.dispatch/transcripts/`. UI preferences (the theme) live in `~/.dispatch/prefs.json`, and running servers register in `~/.dispatch/servers/`. For the GPT limit gauge it reads only the `rate_limits` numbers from Codex's newest local session log. Tokens, API keys and account emails never pass through Dispatch.
