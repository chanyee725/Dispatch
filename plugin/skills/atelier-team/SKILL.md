---
name: atelier-team
description: Start an Atelier team for normal or risky work — a lead (관리자) who plans, assigns and merges, plus implementers and 1 or 2 reviewers. Use for "팀 꾸려서 진행해", "Atelier로 팀 돌려", a feature that spans several files, or risky work (auth, data, delete, structure). For a 1–3 file change use atelier-quickfix.
---

# Atelier team

`<skill-dir>` is this file's folder. The server must run (`atelier-setup`).

## Pick the lane

| Lane | When | Team | Merge |
|---|---|---|---|
| quickfix | 1–3 files: UI position, copy, CSS, test updates | use `atelier-quickfix` | — |
| normal | one feature | lead + impl + 1 fresh reviewer | the lead merges |
| risky | auth, data, delete, structure | lead + impl + 2 reviewers | the main session confirms, then the lead merges |

## Steps

1. Pick the preset from the lane. `small` (lead, impl, review, test) fits normal; `risky` (lead, impl, review ×2) fits risky; `standard`, `ui` and `full` add a second implementer, a tester, a designer or docs for bigger work. Size down when `limits.five` or `limits.seven` is above 0.7.
   Models: roles use the project's role models (Claude for lead, impl, review; Gemini Flash for test, design, docs when Gemini is connected). For a UI, CSS, copy or mechanical issue, run with `DISPATCH_TEAM_ROLE_MODELS='{"impl":"gemini-3.8-flash-high"}'`. For a research-only task add `DISPATCH_TEAM_MODE=research` (any mode: plan, impl, review, docs, quickfix, research) so sessions use that mode's profile.
   Done when: you can name the lane, the preset and the implementer's model in one line.
2. Start the team: `<skill-dir>/scripts/team.sh "<project-root>" <preset> "<task in the user's words>"`. It starts or reuses the server, creates the lead, then every teammate as the lead's child with [reference/rules.md](reference/rules.md) prepended.
   Done when: it prints one line per session (name, model, branch).
3. Hand over: give the user the URL and the session list. The lead runs the team from here and reports back.
   Done when: the lead shows `running` in `GET /api/state`.

## Other scripts

- One more teammate: `DISPATCH_PORT=<port> <skill-dir>/scripts/add.sh "<lead name or id>" <role> "<task>" [model]`. Refused when the lead has 8 open children.
  Done when: it prints the new session line.
- Next issue with a fresh team (the lead runs this after each merged issue; one team per issue keeps token use down): `<skill-dir>/scripts/relay.sh "<project-root>" "<old lead>" <preset> "<task with the remaining issues>"`. Starts the new team, then removes the old lead and its teammates; an empty task only removes them.
  Done when: it prints the new team's session lines (or nothing for an empty task) and the old lead is gone from `GET /api/state`.
- Same permission mode for everyone: `DISPATCH_PORT=<port> <skill-dir>/scripts/auto-all.sh [auto|acceptEdits|plan|manual]`.
  Done when: it prints one `name: old → new` line per changed session.

## Main session

The session talking to the user may do a quickfix itself (`atelier-quickfix`). Normal and risky work goes to a lead. A different stream (another area, or a lead that shows `longRun`) gets a new lead. The plugin hook `main-delegates` reminds you when you edit more than 3 files in a project with a live server.

The server refuses new Claude sessions at the limit guard (`settings.guard`); relay its message. Tasks carry no secrets.
