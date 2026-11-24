---
name: atelier-settings
description: Read and change Atelier's settings and machine-wide numbers — cost and tokens of the last 14 days, the branch graph, the session timeline, usage limits, the limit guard and team settings (models per role, max teammates, rotation, context and stuck guards), user defaults, PR tracking, provider connections and the workspace folder. Use for "비용 얼마 썼어", "브랜치 상태", "한도 가드 바꿔줘", "역할별 모델 바꿔줘", "Codex 연결해줘", "작업 폴더 바꿔줘".
---

# Atelier settings

`<plugin-root>` is two levels above this file's folder. Calls go through `<plugin-root>/scripts/api.sh [-C <project-root>] METHOD PATH [BODY]`. Full fields: `../atelier-setup/reference/api.md` ("Providers and settings").

## Read

| Ask | Call | Answer from |
|---|---|---|
| 비용·토큰 | `GET /api/usage` | `days[]`: `cost`, `models`, `roles` per day (14 days) |
| 브랜치 | `GET /api/branches` | `base`, `tips[]` (`branch`, `ahead`, `behind`, `state`) |
| 세션 타임라인 | `GET /api/timeline` | `sessions` → `[[at, state], …]` (2 hours) |
| 한도 | `GET /api/limits` | `claude.windows[]` (`label`, `used` 0–1, `reset`), `openai`, `gemini` |
| 현재 설정 | `GET /api/state` | `settings.guard`, `settings.team`, `providers`, `roles`, `models` |
| 기본값 | `GET /api/user-defaults` | `values` (port, theme, team role models) from `~/.atelier/drawing.json` |
| PR 추적 | `GET /api/workspace/pr-tracking` | `on` |
| 작업 폴더 | `GET /api/workspaces` | `current`, `folders[]` |

Done when: the user has the number or state, in one or two lines.

## Change (only what the user asked, then read it back)

1. Guard and team: `POST /api/settings '{"guard":{"enabled":true,"five":0.9,"seven":0.85}}'` or `'{"team":{"roleModels":{"impl":"<model id>"},"maxChildren":6}}'`. Model ids come from `GET /api/state` → `models`. Ranges: `ctxHandoff` 0 or 30–95, `handoffMTokens` 0 or 2–500, `maxChildren` 1–16, stuck checks 0 = off. Keep the guards at their defaults unless the user names a value.
2. User defaults: `POST /api/user-defaults '<patch>'` (same keys as `values`).
3. PR tracking: `POST /api/workspace/pr-tracking '{"on":false}'`.
4. Providers: `POST /api/providers/<claude|openai|gemini>/login` (opens the CLI's browser login when needed; `busy` until done), `.../cancel`, `.../logout '{"cli":false}'`, `POST /api/providers/refresh`. Never ask for, read or relay an API key; the user types it in the app's own field.
5. Workspace folder: `POST /api/workspaces/open '{"path":"<listed folder>"}'` or add one with `POST /api/workspaces '{"path":"<abs folder>"}'`; refused while sessions run (`sessions_running`). Open pages reload.

Done when: a second read shows the new value.

## Rules

- No looser permission modes and no bypass anywhere. Credentials stay with each CLI.
