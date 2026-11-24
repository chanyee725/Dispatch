---
name: atelier-session
description: Run and steer single Atelier agent sessions — start one Claude, Codex or Gemini session in its own worktree, send it a message, interrupt, stop or remove it, change its permission mode, answer its permission prompt, and read its transcript or diff. Use for "세션 하나 띄워줘", "그 세션에 이거 전해줘", "멈춰", "권한 허락해줘", "뭐 바꿨는지 보여줘". A whole team goes to atelier-team.
---

# Atelier session

`<plugin-root>` is two levels above this file's folder. Every call goes through `<plugin-root>/scripts/api.sh [-C <project-root>] METHOD PATH [BODY]` (finds the port, adds `x-drawing: 1`). The server must run (`atelier-setup`). Full endpoint list: `../atelier-setup/reference/api.md`.

## Steps

1. Look first. `api.sh GET /api/state` → `sessions` (`id`, `name`, `role`, `provider`, `model`, `perm`, `status`, `state`, `pending`), `roles`, `models`, `providers`.
   Done when: you know the session id you act on, or that a new one is needed.
2. Start a session (only when asked). `api.sh POST /api/sessions '{"worktree":true,"items":[{"role":"impl","task":"<one task>"}]}'`. Item fields: `role` (required, one of `roles`), `n`, `model`, `effort`, `perm` (`manual` · `acceptEdits` · `auto` · `plan`), `prompt`, `task`. Leave out `perm`: the role default is `auto`. Use `manual` only when the user asks for it. The provider must show `connected: true` in `providers`; a refusal names why (limit guard, provider).
   Done when: the reply lists the new session with `status` `starting` or `running`.
3. Steer it.
   - Message: `POST /api/sessions/<id>/message '{"text":"..."}'` (Codex only while `idle`).
   - Stop the turn, keep the session: `POST /api/sessions/<id>/interrupt`.
   - End it: `POST /api/sessions/<id>/kill`. Remove it from the list (worktree too when clean): `POST /api/sessions/<id>/remove`. All finished ones: `POST /api/sessions/clear-done`.
   - Permission mode: `POST /api/sessions/<id>/perm '{"perm":"acceptEdits"}'`. Never looser than the user chose; there is no bypass mode.
   - Attach to a lead: `POST /api/sessions/<id>/parent '{"parent":"<lead-id>"}'` (`null` detaches).
   Done when: `GET /api/state` shows the change on that session.
4. Answer a permission prompt only with the user's word. `pending[]` holds `requestId`, the tool and its input. Show it, ask, then `POST /api/sessions/<id>/permission '{"requestId":"...","behavior":"allow","always":false}'` (or `deny`).
   Done when: `pending` no longer holds that request.
5. Read what it did. `GET /api/sessions/<id>/messages` (transcript, memory only, gone after a restart), `GET /api/sessions/<id>/diff` (`files`, `add`, `del`, `patch`).
   Done when: the user has the answer, summarised. Do not save transcripts to files or documents.

## Rules

- Act on sessions the user named or that you started; ask before killing or removing someone else's.
- `kill` and `remove` cannot be undone; `remove` keeps the branch.
- The live board of every session is `atelier-status`.

## Handing a project to a lead (main session)

- Once a project is handed to a lead, the main session writes no code or analysis for it. A new request goes to that lead with `POST /api/sessions/<id>/message`; the main session only asks the user and relays the answers to the lead.
- Every handoff message names the exact server URL (port and project name) and the API guide `plugin/skills/atelier-setup/reference/api.md`, so the lead never searches widely (`find /`).
