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
   It starts or reuses the server (via `../dispatch/scripts/start.sh`; set `DISPATCH_PORT` if 4317 serves another project), connects Claude in Dispatch when the CLI is logged in, and creates the sessions with `worktree: true`. Done when it prints one line per session (name, model, branch).

3. **Hand over.** Give the user the URL and the session list. The lead (관리자) now runs the team: it splits the task, steers the others through its Dispatch MCP tools, merges reviewed branches and reports. Answer the user's later questions from `GET /api/state` and the lead's transcript (`GET /api/sessions/<lead-id>/messages`).

## Team rules

Every session gets [reference/rules.md](reference/rules.md) prepended to its task: branch and merge discipline, one heavy check at a time, review before merge, what only the user may decide, and privacy. Edit that file to change how every future team works; keep it short, since it is sent with every session.

## Limits

- The server refuses new Claude sessions at or above the limit guard (`settings.guard`); the script stops and prints the server's message — relay it.
- A lead may hold at most 8 open children; presets stay under that.
- Never pass secrets in a task. Sessions must not read `.env` files; they ask the user to set values.
