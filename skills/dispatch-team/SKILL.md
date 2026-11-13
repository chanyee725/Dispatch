---
name: dispatch-team
description: Start a whole working team in Dispatch from one request — a 관리자 (lead) who plans, assigns, reviews-gates and merges, plus implementers, reviewers, a tester, a designer or a docs writer sized to the task. Use when the user says things like "팀 꾸려서 진행해", "dispatch로 팀 돌려", "세션 여러 개로 나눠서 해줘", or hands over a multi-part task they want run by parallel agents. For opening Dispatch or one-off sessions, use the dispatch skill instead.
---

# Dispatch team

Builds on the `dispatch` skill (a sibling directory of this one): that skill starts the server and connects providers; this one picks a team for the task and creates it through the HTTP API with shared working rules. `<skill-dir>` is the directory containing this file.

## Steps

1. **Pick the preset** from the task (ask only if the task is genuinely ambiguous):

   | preset | sessions | fits |
   |---|---|---|
   | `small` | lead, impl, review | one feature or fix |
   | `standard` | lead, impl ×2, review, test | a feature with backend and web parts |
   | `ui` | lead, impl, design, review | screens, layout, copy |
   | `full` | lead, impl ×3, review ×2, test, docs | several features at once |

   Size down when the 5-hour or weekly limit is above ~70% (`GET /api/state` → `limits`); every Claude session spends the same limit.

2. **Start the team.** Run
   `<skill-dir>/scripts/team.sh "<project-root>" <preset> "<task in the user's words>"`.
   It creates the lead first and every teammate as the lead's child, so each teammate's finished turn reaches the lead as a report. It starts or reuses the server (via `../dispatch/scripts/start.sh`; set `DISPATCH_PORT` if 4317 serves another project), connects Claude in Dispatch when the CLI is logged in, and creates the sessions with `worktree: true`. Done when it prints one line per session (name, model, branch).

3. **Hand over.** Give the user the URL and the session list. The lead (관리자) now runs the team: it splits the task, steers the others through its Dispatch MCP tools, merges reviewed branches and reports. Answer the user's later questions from `GET /api/state` and the lead's transcript (`GET /api/sessions/<lead-id>/messages`). From here on you delegate (see below): new work goes to a lead, not to your own edits.

## Main session delegates

You, the session that talks to the user, never implement, fix or investigate code yourself.

- Hand every task to a Dispatch lead. Your part: write briefs, verify before merge, comment on PRs, merge.
- A different stream (another area or repo, or the current lead's context is heavy or it shows `longRun`) gets a **new** lead, not more work on an existing one.
- Small review should-fixes go back to the owning lead; do not patch them yourself.

The plugin's `hooks/main-delegates.mjs` reminds you when you edit a file or run a Bash command that writes one in a project with a live Dispatch server, and again every 30 minutes. It never blocks the edit.

## Permission mode for the whole team

When the user wants every session in one mode (e.g. "전체 auto 로 바꿔"), run
`DISPATCH_PORT=<port> <skill-dir>/scripts/auto-all.sh [auto|acceptEdits|plan|manual]` (default `auto`).
It calls `POST /api/sessions/<id>/perm` for each open session not already in that mode, so transcripts and context stay. Done when it prints one `name: old → new` line per changed session. Every role defaults to `auto`; start a stricter team with `DISPATCH_TEAM_PERM=acceptEdits team.sh …`.

## Add one teammate

`DISPATCH_PORT=<port> <skill-dir>/scripts/add.sh "<lead name or id>" <role> "<task>" [model]` creates one session under that lead with the team rules prepended. The server refuses it when the lead already has 8 open children; stop a finished one first.

## Teams made before parents were set

A teammate without `parent` never reports to the lead, and the lead stalls waiting. Attach each one with `POST /api/sessions/<id>/parent` `{ "parent": "<lead-id>" }` (server must include that route; restart it when it does not) and forward any answers the lead missed.

## Team rules

Every session gets [reference/rules.md](reference/rules.md) prepended to its task: branch and merge discipline, one heavy check at a time, review before merge, what only the user may decide, and privacy. Edit that file to change how every future team works; keep it short, since it is sent with every session.

## Web work

When the `modern-web-guidance` Claude Code plugin (`modern-web-guidance@googlechrome`) is installed, the server adds a `[Modern Web Guidance]` section to the implementer, designer and reviewer prompts, and the lead is told to put it in web briefs: for HTML, CSS or client-side JS, run the `modern-web-guidance:modern-web-guidance` skill (search → retrieve → check the code against the guide) and end the report or PR with a `### Modern Web Guidance` section. Project rules win over the guides, and queries stay generic (no project, file or people names). Server, test and build work doesn't use it. Codex and Gemini sessions skip the guide at once when `npx` fails or there is no network (no retry, approval request or sandbox loosening) and note "가이드 조회 불가(네트워크 없음)" in the section; the lead counts that as filled. Without the plugin nothing is added.

## Limits

- The server refuses new Claude sessions at or above the limit guard (`settings.guard`); the script stops and prints the server's message — relay it.
- A lead may hold at most 8 open children; presets stay under that.
- Never pass secrets in a task. Sessions must not read `.env` files; they ask the user to set values.
