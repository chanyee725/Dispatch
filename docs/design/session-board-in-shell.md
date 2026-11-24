# 세션 보드 inside the Atelier shell (E562, issue #731)

The 세션 보드 stops being a separate page (`/dispatch`, its own header and project rail) and becomes a section of
the Atelier shell: the left sidebar stays exactly as it is, the board fills the main area like 홈 and 최근 do.
It is a mini dashboard: sessions per project and usage on one screen. Clicking a session opens the agent live view
(#728, `docs/design/agent-live-view.md`). Standalone Dispatch is retired; every link to it goes.

Design only; implementation follows this file. Mockup: `docs/design/session-board-in-shell/mockup.html`
(screenshots `desktop.png`, `phone.png` next to it). Not touched here: the live view panel itself (#728, PR #749)
and diagram rendering (#733).

## 1. Route and entry points

| Where | Today | After |
|---|---|---|
| Shell state (`web/src/projectNav.ts` `Section`) | `all · recent · project · doc` | add `{ kind: 'board'; tab: 'sessions' \| 'timeline' \| 'usage'; folder?: string }` |
| URL | `/dispatch#folder=…`, `#usage`, `#timeline`, `#tv`, `#settings` | `/#board`, `/#board=usage`, `/#board=timeline`, `&folder=<path>` appended; back/forward works through `hashchange` like `#file=` |
| Sidebar row 세션 보드 (`Sidebar.tsx:63`, `boardHref`) | full page load to `/dispatch` | `SidebarMenuButton` (not a link to another page) → `showSection({ kind: 'board', tab: 'sessions', folder })`, `aria-current="page"` while open, shortcut hint `S` like the other view rows (A·R·B today; S is unused) |
| 프로젝트 대시보드 (`home/ProjectDashboard.tsx:34`, `home/ProjectSessions.tsx:30`) | `/dispatch#folder=` link | same in-shell board, scoped to that folder |
| Toast 세션 열기 (`App.tsx:903`) | `location.assign('/dispatch')` | `openAgentLive(id)` (#728); fallback below |
| `/dispatch` (bookmarks, old links) | the Dispatch screen | client redirect to `/#board` keeping the hash (`#usage` → `#board=usage`, `#folder=x` → `&folder=x`, `#tv` → 상시 화면, `#settings` → 설정 dialog) |
| Project mode (`server/app.js:222`, no workspace, editor URLs 302 to `/dispatch`) | the Dispatch screen | unchanged URL, but it renders the same `SessionBoard` component (no sidebar: there is no workspace to list). Same code, so it is not a second UI |

The 상시 화면 (`AlwaysOnView`, wall display) stays a full-screen mode, opened from the board's ⋯ menu; `Esc` /
나가기 returns to the board.

## 2. Layout (main area)

```
┌ sidebar (unchanged) ┐┌──────────────────────────────────────────────────────────────────────────────┐
│ 홈 · 최근 · 보관함  ││ 세션 보드   [전체 프로젝트 ▾]   세션 · 타임라인 · 사용량          [+ 새 세션] [⋯] │ 48px header
│ ▸ 세션 보드 (현재)  ││ ● 작업 중 4  ◐ 사람 기다림 1  ▲ 멈춤 0  ✕ 실패 0  · 오늘 $12.40 · 토큰 1.2M          │ summary line
│ 작업 중인 에이전트  │├──────────────────────────────────────────────────────┬───────────────────────┤
│ 프로젝트 …          ││ 확인 필요 (1)  Rio 권한 요청 · 3분째          [열기]   │ 사용량                │
│                     ││──────────────────────────────────────────────────────│ ┌ Claude ───────────┐ │
│                     ││ drawing-app  ·  세션 3 · $6.10                    ⌄ │ │ 5시간  ▓▓▓▓▓░ 62% │ │
│                     ││ ● Otto  구현자  Opus 5.5   API 라우트 추가  12분 › │ │ 주간   ▓▓▓░░░ 41% │ │
│                     ││ ◐ Rio   리뷰어  Sonnet 5.5 PR 리뷰  권한 요청 3분 › │ │ Fable  ▓░░░░░ 18% │ │
│                     ││ ● Pia   관리자  Sonnet 5.5 —            1시간 4분 › │ │ 2시간 뒤 초기화    │ │
│                     ││                                                      │ └───────────────────┘ │
│                     ││ docs-site  ·  세션 1 · $0.80                      ⌄ │ ┌ Codex ────────────┐ │
│                     ││ ● Mina  문서화  GPT-5.5    목차 정리          4분 › │ │ 5시간 · 주간      │ │
│                     ││                                                      │ └───────────────────┘ │
│                     ││ 미분류  ·  세션 0                                    │ Gemini  연결 안 됨 [연결]│
│                     ││ 끝난 세션 2개 보기 ⌄                                 │ 실행 중 4 · $8.20      │
│                     ││                                                      │ 가드: 5시간 85% · 주간  │
│                     ││                                                      │ 90%에서 새 세션 멈춤   │
│                     ││                                                      │        [가드 바꾸기 ›] │
└─────────────────────┘└──────────────────────────────────────────────────────┴───────────────────────┘
```

- Header 48px, `px-6` (`px-4` under 768px, `px-3` under 640px), same as the shell's other screens. `h1` 세션 보드 is
  15px/600. Scope select: `전체 프로젝트` + one item per project (+ 미분류). Tabs are links with `aria-current="page"`
  plus an underline (not colour only). `+ 새 세션` opens the existing `CreateSessionDialog`; ⋯ menu: 끝난 세션 정리,
  모든 세션 정리 (confirm), PR 추적 (switch), 상시 화면, 설정.
- Body is a container (`container-type: inline-size`). `≥ 960px` container: grid `minmax(0,1fr) 320px`, gap 24px.
  Below: one column, order 확인 필요 → 세션 → 사용량. Phone also gets a one-line usage strip under the summary
  (`Claude 5시간 62% · 주간 41%`) that jumps to the 사용량 block, so limits are visible without scrolling.
- Session groups: `<section aria-labelledby>`, header row 32px: project name (13px/600), count, cost, collapse
  toggle (`aria-expanded`). Folder order: groups with 확인 필요 first, then by most recent activity; 미분류 last and
  hidden when empty. Done sessions fold under `끝난 세션 N개 보기`.
- Session row: one `<button>` per row, 44px tall (touch target), 8px radius on hover/focus, columns via subgrid so
  names, roles and times line up across groups: state icon · name (600) · role tag (role colour dot + label) ·
  `ModelTag` · 현재 단계 (pipeline step, else `nowLine` activity, else `—`) · 경과 (time in state, `tabular-nums`)
  · `›`. Under 560px container the row wraps to two lines: name/role/elapsed, then model · step.
- Waiting/stuck rows: `bg-warn/5` + left 2px `--warn` bar; failed: `--destructive`. Always with the state icon
  and label (shape + colour + text, same as `StatusBadge`).
- Usage column: one card per connected provider (`bg-card`, 1px border, 12px padding). Rows reuse the sidebar
  usage card (`SidebarUsageCard.cardRows`, `Meter`): label, meter, %, reset time. Claude shows 5시간, 주간 and
  Fable (`limits.fable`). Codex shows its 5시간/주간 from the session-log numbers. Not connected providers collapse
  to one line with `연결` (opens 설정 › 모델 연결). Under the cards: 실행 중 세션 합계 (count, tokens, cost) and the
  guard thresholds as text with `가드 바꾸기` (opens 설정 › 한도). Meter colour by level: `--ok` < 70%, `--warn`
  70–89%, `--bad` ≥ 90%, plus the number, never colour alone.
- Tokens: dark chrome tokens only (`--background`, `--card`, `--border`, `--muted-foreground`, `--sidebar`); hue
  only for state (`--ok/--warn/--bad/--idle/--destructive`) and role dots (`--role-*`). Text 13px rows, 12px
  secondary, numbers `tabular-nums`.

### Labels (해요체, short)

세션 보드 · 전체 프로젝트 · 세션 · 타임라인 · 사용량 · 새 세션 · 확인 필요 · 끝난 세션 N개 보기 · 끝난 세션 정리 ·
모든 세션 정리 · 상시 화면 · 설정 · 연결 안 됨 · 연결 · 가드 바꾸기 · 사용량 자세히 · 지금 생각 중 · N분째 ·
초기화까지 2시간 · 실행 중인 세션이 없어요 · 새 세션을 만들면 여기에 보여요.

## 3. States

| State | Shows |
|---|---|
| Loading (`!ready`) | header + skeleton rows (3 per group, no shimmer under `prefers-reduced-motion`) |
| Offline (`ready && !online`) | `Alert` under the header: 서버와 연결이 끊겼어요. 다시 연결하는 중이에요. Data stays, greyed 60% |
| Dispatch off (`unavailable`, workspace setting) | existing `settings/DispatchOff.tsx` message in the main area, sidebar normal |
| No sessions | empty state in the sessions column: 실행 중인 세션이 없어요 + `새 세션` button; usage column still shows |
| No provider connected | usage column: 연결된 모델이 없어요 + `모델 연결` (설정 › 모델 연결); `새 세션` disabled with that title |
| Project list failed | one-line notice (as today); sessions still listed, grouped by `cwd` folder name |
| Scoped to a project | only that group; its header gets no collapse toggle; usage stays global (limits are per account) |

## 4. Session click → live view

- Row click / Enter → `openAgentLive(id, { trigger: row })` from #728 (`web/src/live/openAgentLive.ts`, PR #749).
  The panel docks right over the board; the board stays usable; `aria-expanded` on the row while it is open.
- The panel footer `대화 보기` opens the existing `SessionSheet` (transcript, 변경사항, 정보, permission/answer cards,
  메시지, 멈추기, 끝내기). So stop/interrupt/answer stay reachable in two clicks.
- Until #749 lands: row click opens `SessionSheet` directly. Implementation keeps one call site
  (`openSession(id, trigger)`) so the swap is one line.
- Keyboard: rows are buttons in DOM order; `Tab` moves row to row, groups' collapse toggles are reachable;
  no roving tabindex needed at this size.

## 5. Data (existing APIs only)

All from the Dispatch store already used by `/dispatch` (`web/src/dispatch/store.ts`, `connect()`, SSE
`GET /api/events`); nothing new on disk.

| Need | Source |
|---|---|
| Sessions (role, model, state, step, cost, tokens, cwd, parent) | `GET /api/state` snapshot + `session`/`removed` events |
| Project groups | `GET /api/projects` (Atelier `projectsApi.projects()`), `dispatch/lib/folder.ts` |
| Limits (Claude 5h/7d/Fable, Codex) | `GET /api/limits` + `limits` event |
| Guard thresholds | `settings` slice (`GET /api/state`), edited in 설정 › 한도 (`POST /api/settings`) |
| Usage detail tab | `GET /api/usage` (existing `UsagePage`) |
| Timeline tab | `GET /api/timeline` (existing `SessionTimeline`) |
| Create / stop / interrupt / answer | `POST /api/sessions`, `/kill`, `/interrupt`, `/permission`, `/message` (existing dialogs) |
| Clear | `POST /api/sessions/clear-done`, `POST /api/sessions/clear` (API exists, no UI yet) |
| Providers | `POST /api/providers/<id>/login · logout · cancel · key · refresh` (설정 › 모델 연결, exists) |

Reuse: `SessionsPage` pieces (`AttentionStrip`, `SummaryLine`, `useNow`, `StatusBadge`, `ModelTag`, `Meter`,
`lib/order.ts byUrgency`, `lib/turn.ts nowLine`), `UsagePage`, `SessionTimeline`, `CreateSessionDialog`,
`SettingsDialog`, `PrTrackingToggle`, `AlwaysOnView`, `SidebarUsageCard.cardRows`. The new piece is
`SessionBoard` (header + grouped rows + usage column) rendered by `App.tsx` for `section.kind === 'board'`, lazy
loaded like `/dispatch` is today so the editor bundle does not grow.

## 6. Links to remove

`Sidebar.tsx:63` `boardHref`, `home/ProjectDashboard.tsx:34`, `home/ProjectSessions.tsx:30`, `App.tsx:903`
(`location.assign('/dispatch')`), `dispatch/index.tsx` own header/rail (replaced by the shell). Nothing in
`web/src` links to the standalone Dispatch server (other port); keep it that way (no `localhost:` links).

## 7. What standalone Dispatch does that Atelier lacks

Server routes are at parity (same table in `server/dispatch/routes.js`). The gaps are UI and tooling:

| Standalone Dispatch | Atelier today | Proposal |
|---|---|---|
| 끝난 세션 정리 / 모두 정리 buttons (`ClearDoneButton`, `ClearAllButton`) | API only | board ⋯ menu (this issue) |
| Tickets: resume / close (`TaskBoard` ticket rows) | `tickets` in store, no UI | add to the existing 작업 보드 dialog (follow-up) |
| Branch graph (`BranchGraph`, `/api/branches`) | used only for the project feed | follow-up, low priority (PR list covers most) |
| Project switcher across Dispatch servers (`ProjectSwitcher`, one server per project) | not needed: board groups by project folder in one server | drop |
| Change a running session's permission mode (`POST /perm`) and parent (`/parent`) | API only, no UI | 정보 tab of `SessionSheet` (follow-up) |
| Skills `dispatch`, `dispatch-team`, `dispatch-update` start/open the standalone server | — | retarget to Atelier's server and `/#board` before retiring (separate issue) |
| Hooks (`long-session.mjs`, `main-delegates.mjs`) and `scripts/setup.sh · update.sh` | not ported | decide per hook; session-length guard already in Atelier settings |
| MCP `message_lead` for teammates | ported (`server/dispatch/mcp.js`) | — |

## 8. Out of scope

The live view panel (#728), diagram rendering (#733), new server endpoints, changing guard defaults.
