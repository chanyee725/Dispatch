<div align="center">

# Atelier

**Run and watch AI agent sessions in one local app.**<br>
Start Claude Code, Codex and Gemini sessions and teams, follow them on the session board, and talk to them in the chat.

**English** · [한국어](README.ko.md)

[![version](https://img.shields.io/badge/version-0.1.0-6366f1)](CHANGELOG.md)
[![node](https://img.shields.io/badge/node-%E2%89%A522.18-339933?logo=nodedotjs&logoColor=white)](#-quick-start)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-d97757)](#-install-the-skills)
[![Codex plugin](https://img.shields.io/badge/Codex-plugin-111111)](#-install-the-skills)
[![local only](https://img.shields.io/badge/127.0.0.1-local_only-0ea5e9)](#-privacy-and-local-only)

<a href="docs/images/demo.mp4"><img src="docs/images/demo-poster.png" alt="Demo: an Atelier team plans a web page that reads PLC data and moves a robot" width="900"></a>

<sub>Demo video · <a href="docs/images/demo.mp4">Watch the MP4</a> <!-- TODO(youtube): swap the MP4 link for the YouTube link once uploaded --> · a lead and a teammate plan "a web page that takes PLC data and moves a robot" with the real Claude CLI</sub>

</div>

## ✨ Features

- **Session board**: the first screen. Who does what, stage and time left per task, branches, cost and the 5-hour and weekly usage limits.
- **Projects and sessions**: the sidebar lists project folders; pick one to see its sessions.
- **Agent teams**: a lead, implementers and reviewers (Claude Code, Codex or Gemini) work in their own git worktrees, review each other and open PRs.
- **Chat**: talk to a session from the app; saved chats are listed in the sidebar.
- **Local only**: the server listens on `127.0.0.1` and sends nothing out.

## 🚀 Quick start

You need Node.js 22.18+ and git.

```bash
git clone https://github.com/chanyee725/Atelier.git
cd Atelier
npm install && npm run build
mkdir -p ~/atelier-notes && npm start -- ~/atelier-notes
```

Open the address it prints (default `http://127.0.0.1:4330/`).

| Setting | Meaning |
|---|---|
| `<workspace>` | The folder your files live in. Create it first. |
| `DRAW_PORT` | Port, 4330 when unset. `DRAW_PORT=4340 npm start -- <workspace>` |

- Without `npm run build` the page says "Web app not built".
- When the port is taken, the server stops at once and asks for another one.

## 🔌 Install the skills

Install straight from GitHub; the marketplace at the repo root points at `plugin/`.

**Claude Code**

```text
/plugin marketplace add chanyee725/Atelier
/plugin install atelier@atelier
```

**Codex CLI**

```bash
codex plugin marketplace add chanyee725/Atelier
codex plugin add atelier@atelier
```

Then say "Atelier 켜줘" (or run the `atelier-setup` skill) in a project. Details: [plugin/README.md](plugin/README.md).

## 🧩 7 skills

| Skill | What it does | Say |
|---|---|---|
| `atelier-setup` | Start or stop the server for a project; connect Claude, Codex, Gemini | "start Atelier" |
| `atelier-update` | Update to the latest GitHub release and restart servers | "update Atelier" |
| `atelier-team` | A lead, implementers and reviewers for one issue | "run this as a team" |
| `atelier-quickfix` | A 1–3 file change in one session | "just fix the copy" |
| `atelier-session` | One session: start, message, interrupt, permissions | "start one session" |
| `atelier-status` | Sessions, ETAs, stuck flags, usage limits | "what's everyone doing?" |
| `atelier-settings` | Cost and tokens, limit guard, model per role | "change the model per role" |

## 🧭 How a team runs

1. Tell a lead what you need, in one line: "We need a web page that takes PLC data and moves a robot."
2. The lead adds teammates and assigns the work.
3. Implementers work in git worktrees, a fresh reviewer comments on each PR, and the merge role merges reviewed PRs.
4. The session board shows every session and task live.

## 🔒 Privacy and local only

- The server listens on `127.0.0.1` only, and its code makes no outbound requests. Fonts and icons are bundled.
- It writes only inside the workspace, the git project that holds it, and a shared usage-limit folder.
- Agent transcripts stay in memory. Disk keeps metadata only: steps, times, model, tokens, cost, branch, commit, PR number.
- Sessions use only the CLIs you connected (`claude`, `codex`, `agy`), and the server never reads their credentials.

## 🏗 Layout

```text
server/   127.0.0.1 server: agent sessions, teams, usage and chat (server/dispatch)
web/      React app: session board, sidebar, chat, settings
shared/   session types and helpers shared by server and web
plugin/   Claude Code and Codex plugin: 7 skills and hooks
scripts/  packaging, demo recording (record-demo.mjs)
test/     node:test tests, fake agent CLIs, headless e2e
```

## 🛠 Development

| Command | What it does |
|---|---|
| `npm test` | server and web logic tests (fake CLIs only) |
| `npm run build` | build the web app into `public/` |
| `npm run dev:web` | Vite dev server (`/api` goes to the server on 4330) |
| `node scripts/record-demo.mjs` | re-record the demo: a scratch project under `/tmp` on a free port, the real Claude CLI (claude-sonnet-5-5) planning only; writes `docs/images/demo.mp4` and `demo-poster.png`. Needs `CHROME`, `PLAYWRIGHT_CORE` and a logged-in `claude`; `DEMO_FAKE=1` checks the script with the fake CLI |

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
