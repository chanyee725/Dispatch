<div align="center">

<img src="./web/brand/dispatch-logo.png" alt="Dispatch Modules logo" width="56">

# Dispatch

**Run and watch AI agent sessions in one local app.**<br>
Start Claude Code, Codex and Gemini sessions and teams, then follow their work on the session board.

In 1.2, open the session board and select a lead to see their team. Check the task board for each task’s ETA and assignee.

**English** · [한국어](README.ko.md)

[![version](https://img.shields.io/badge/version-1.2.0-6366f1)](CHANGELOG.md#120)
[![node](https://img.shields.io/badge/node-%E2%89%A522.18-339933?logo=nodedotjs&logoColor=white)](#-quick-start)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-d97757)](#-install-the-skills)
[![Codex plugin](https://img.shields.io/badge/Codex-plugin-111111)](#-install-the-skills)
[![local only](https://img.shields.io/badge/127.0.0.1-local_only-0ea5e9)](#-privacy-and-local-only)

</div>

## ✨ Features

- **Session board**. **전체** groups sessions by lead and includes a **관리자 연결 없음** group for unlinked sessions. Select a lead to see their subordinate sessions.
- **Task board**. Check the stage, ETA and assignee in each task row. The ETA shows time remaining or time overdue when available. Unassigned tasks show **맡은 사람 없음**.
- **Projects**. The sidebar shows the names and count of projects with confirmed running Dispatch services. Select a name to open that service’s board. Open the session board to see sessions.
- **Agent teams**. A lead, implementers and reviewers (Claude Code, Codex or Gemini) work in their own git worktrees, review changes and open PRs.
- **Branches and usage**. Open these views from the sidebar to check branches, costs and provider usage limits.

## 🚀 Quick start

You need Node.js 22.18+ and git.

```bash
git clone https://github.com/chanyee725/Dispatch.git
cd Dispatch
npm install && npm run build
mkdir -p ~/dispatch-notes && npm start -- ~/dispatch-notes
```

Open the address it prints (default `http://127.0.0.1:4330/`).

| Setting | Meaning |
|---|---|
| `<workspace>` | The folder your files live in. Create it first. |
| `DISPATCH_PORT` | Port, 4330 when unset. `DISPATCH_PORT=4340 npm start -- <workspace>`. The older name `DRAW_PORT` still works; `DISPATCH_PORT` wins when both are set. |

- Without `npm run build` the page says "Web app not built".
- When the port is taken, the server stops at once and asks for another one.

## 🔌 Install the skills

Install straight from GitHub. The plugin is the repository root (as before 1.0, so the server comes with it); its skills and hooks live in `plugin/`.

**Claude Code**

```text
/plugin marketplace add chanyee725/Dispatch
/plugin install dispatch@dispatch
```

**Codex CLI**

```bash
codex plugin marketplace add chanyee725/Dispatch
codex plugin add dispatch@dispatch
```

Then say "디스패치 켜줘" (or run the `dispatch` skill) in a project. Details: [plugin/README.md](plugin/README.md).

### Coming from Atelier or Dispatch 0.x

Dispatch 1.0 is the app that was called Atelier, under the Dispatch name. Nothing is deleted on the way:

- **Atelier projects**: `<project>/.atelier` is left as it is. On start the server copies project state, including the board and settings, into `<project>/.dispatch` once no session is saved in `.atelier` (until then it keeps using `.atelier`). Old worktrees stay where they are.
- **Your defaults**: `~/.atelier/drawing.json`, `limits.json` and `prefs.json` are copied to `~/.dispatch/` once, only where `~/.dispatch/` has no such file.
- **Dispatch 0.x projects**: an existing `<project>/.dispatch` (worktrees in `wt/`) is used as it is. Stop the 0.x server first. `~/.dispatch/servers/` (the 0.x registry) is not read or written.
- **Environment**: `ATELIER_API_TIMEOUT` and `ATELIER_QUICKFIX_FILES` still work; the new names are `DISPATCH_API_TIMEOUT` and `DISPATCH_QUICKFIX_FILES`.

## 🧩 7 skills

| Skill | What it does | Say |
|---|---|---|
| `dispatch` | Start or stop the server for a project; connect Claude, Codex, Gemini | "start Dispatch" |
| `dispatch-update` | Update to the latest GitHub release and restart servers | "update Dispatch" |
| `dispatch-team` | A lead, implementers and reviewers for one issue | "run this as a team" |
| `dispatch-quickfix` | A 1–3 file change in one session | "just fix the copy" |
| `dispatch-session` | One session: start, message, interrupt, permissions | "start one session" |
| `dispatch-status` | Sessions, ETAs, stuck flags, usage limits | "what's everyone doing?" |
| `dispatch-settings` | Cost and tokens, limit guard, model per role | "change the model per role" |

## 🧭 How a team runs

Send the lead a short instruction through the `dispatch-session` skill.

1. The lead adds teammates and assigns the work.
2. Implementers work in git worktrees, reviewers check the changes, and the lead merges reviewed PRs.
3. Follow sessions and tasks on the session board.

Check the lead’s card or live view for **메시지 N건 대기** when messages are queued. A lead takes user instructions, teammate messages and automatic reports in arrival order, one per turn. Set the waiting limit per lead in **Settings → 관리자와 팀 → 관리자 메시지 최대 대기** (default 20, range 1–100). The displayed count is capped at this limit.

When automatic replacement switches a lead to a fresh session, the handoff, teammates, task board and queued messages follow. For a manual handoff, use `POST /api/tasks/:id/handoff` to transfer a task card and selected teammates to another lead in the same project. The card’s ID and stage history stay with it.

To enable cleanup for finished leads, turn on **Settings → 관리자와 팀 → 끝난 관리자 자동 정리**. An idle lead with at least one card qualifies once all cards have verified merges, the team has finished, and no work or responses are pending. The default grace period is 120 seconds. A lead can also request cleanup with `finish`. Cleanup preserves worktrees and task cards.

## 🔒 Privacy and local only

- The server listens on `127.0.0.1` only, and its code makes no outbound requests. Fonts and icons are bundled.
- It writes only inside the workspace, the git project that holds it, and a shared usage-limit folder.
- Agent transcripts stay in memory. Disk keeps metadata only: steps, times, model, tokens, cost, branch, commit, PR number.
- Sessions use only the CLIs you connected (`claude`, `codex`, `agy`), and the server never reads their credentials.

## 🏗 Layout

```text
server/   127.0.0.1 server: agent sessions, teams and usage (server/dispatch)
web/      React app: session board, sidebar, usage and settings
shared/   session types and helpers shared by server and web
plugin/   Claude Code and Codex plugin: 7 skills and hooks
scripts/  packaging and development utilities
test/     node:test tests, fake agent CLIs, headless e2e
```

## 🛠 Development

| Command | What it does |
|---|---|
| `npm test` | server and web logic tests (fake CLIs only) |
| `npm run build` | build the web app into `public/` |
| `npm run dev:web` | Vite dev server (`/api` goes to the server on 4330) |

Browser e2e tests are skipped unless you turn them on:

```
DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
```

Work is tracked in GitHub issues; changes are in [CHANGELOG.md](CHANGELOG.md).

## Not supported

- Real-time multi-user editing, remote access, accounts
- Documents, canvas, diagrams and plan runs (removed 2026-11-23)

## License notes

Third-party notices are in [NOTICE.md](NOTICE.md).
