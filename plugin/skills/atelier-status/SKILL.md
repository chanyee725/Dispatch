---
name: atelier-status
description: Show what every Atelier agent is doing — state, time in state, ETA, stuck flags, context, the task board, and the 5-hour and weekly limits with the guard. Use for "지금 뭐 하고 있어", "진행 상황", "한도 얼마 남았어", "막힌 세션 있어".
---

# Atelier status

`<skill-dir>` is this file's folder. Reads only; nothing changes.

## Steps

1. Print the board: `<skill-dir>/scripts/status.sh "<project-root>"`. It reads `GET /api/state` and `GET /api/tasks` on the project's port.
   Done when: it prints the limits line, the sessions and the open tasks.
2. Answer from it. Lead with what needs a person: `⚠` lines (`attention`, `stuck`, `longRun`), then tasks past their ETA, then the limits.
   Done when: the user knows which session needs them, if any.
3. Dig in only when asked. `GET /api/sessions/<id>/messages` holds a session's transcript (memory only, gone after a restart); `GET /api/sessions/<id>/diff` its changes; `GET /api/events` streams live updates (SSE: `session`, `tasks`, `limits`).
   Done when: the question is answered from those reads.

## Reading the numbers

- `limits.five` / `limits.seven`: share of the 5-hour and weekly Claude limits used (0–1). `settings.guard` refuses new Claude sessions at or above its thresholds (default 90% / 85%).
- `state`: `working` · `waiting` (needs a person) · `stuck` · `failed` · `resting` · `done`.
- Task `stuck`: `stage-mismatch` (tests loop while the stage says plan or impl) or `over-eta`.
