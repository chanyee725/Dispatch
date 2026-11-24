# Agent live view (E559, issue #728)

"모델 작업 진행상황 보기": click an agent anywhere in the app and a panel shows what that model is doing right
now. Design only; implementation follows this file. #736 (in-progress diagram node, hover card + click) reuses the
open entry point and the summary component defined here.

Privacy: everything comes from the hub's in-memory session state (`server/dispatch/hub.js`). Nothing new is written to
disk, no transcript text is kept or shown here (tool names, short targets and paths only, masked by `redact`), run
records stay metadata only.

## 1. Surface

A **non-modal side panel** docked to the right edge, 460px wide (`min(460px, 100vw - 2rem)`), full height under the
top bar. The page stays usable: the user keeps reading the document or diagram while watching, and a file click
opens the document behind the panel without closing it.

- Element: `<dialog popover="manual" aria-labelledby=…>` (an inspector panel, guide `dialog` Rule 2). Not
  `showModal()` and not the existing Radix `Sheet` (that one is modal and blocks the page).
- One panel at a time. Opening another agent swaps the content in place (no second panel, no animation of the swap).
- Closes by: the ✕ button, `Esc` while focus is inside the panel, or opening the same agent again from its trigger.
  On close, focus goes back to the trigger that opened it (stored by `openAgentLive`, see §5).
- Below 720px viewport width it becomes a bottom sheet (full width, 70vh), same content.
- Colours: app dark chrome tokens only (`--background`, `--card`, `--border`, `--muted-foreground`). Hue only for
  status (`--ok`, `--warn`, `--bad`, `--idle`, `--destructive`) and the agent's own cursor colour (the dot/tag).

## 2. Layout

```
┌──────────────────────────────────────────────┐
│ ▸Otto  구현자 · ⓒ Opus 5.5            [⤢] [✕] │  header: AgentTag (cursor colour), role, ProviderIcon + model
│ ● 작업 중 · 12분째                             │  status dot + state label + time in state   (aria-live=polite)
├──────────────────────────────────────────────┤
│ 단계   API 라우트 추가                         │  pipeline step (AgentPresence.step); row hidden when none
│ 지금   파일 수정  server/app.js          0:42 │  current tool: activity label, target, own clock
├──────────────────────────────────────────────┤
│ 경과 1시간 4분   토큰 182k   비용 $3.12        │  3 stat cells, tabular-nums; 비용 cell hidden if cost null
│ 컨텍스트 ▓▓▓▓▓▓░░░░ 58%                        │  ctx / ctxWindow, thin bar
├──────────────────────────────────────────────┤
│ 최근 행동                                      │  h3
│ 14:02  파일 수정  server/app.js            ✓  │  newest first, max 12 rows
│ 14:01  단위 테스트  npm test -- app.spec   ✗  │  ✗ = tool result had error (--destructive)
│ 14:00  코드 읽기  web/src/api.ts           ✓  │
│ …                                             │
├──────────────────────────────────────────────┤
│ 건드린 파일 (4)                                │  h3
│ ✎ server/app.js                    2분 전     │  ✎ edited / 👁 read only (icon, plus sr text)
│ ✎ docs/plan.dpx.json  → 문서 열기             │  workspace documents are links (open the doc)
│ 👁 web/src/api.ts                              │  code files outside the workspace: plain text, not links
├──────────────────────────────────────────────┤
│ [대화 보기]                                    │  footer: opens the existing SessionSheet (full transcript)
└──────────────────────────────────────────────┘
```

Spacing: panel padding 16px, section gap 12px with a 1px `--border` divider, rows 28px (timeline) / 30px (files),
text 13px, secondary 12px `--muted-foreground`, time column fixed 40px, all numbers `tabular-nums`. Targets truncate
in the middle (`server/…/app.js`) with the full value in `title`.

The **⤢** button (optional, can land later) opens the same view full-width inside the 세션 보드 route; #736 may use
it for "a separate tab".

### Labels (해요체, short)

| Place | Copy |
|---|---|
| Panel name (aria) | `{name} 작업 진행상황` |
| States | 작업 중 · 생각 중 · 사람 기다림 · 멈춤 · 실패 · 끝났어요 (from `SessionState`, same words as the board) |
| Current tool, none | `도구 실행 없음` (between tools) |
| Stats | 경과 · 토큰 · 비용 · 컨텍스트 |
| Sections | 최근 행동 · 건드린 파일 |
| Footer | 대화 보기 |
| Close | 닫기 (aria-label of ✕) |

## 3. States

| State | What shows |
|---|---|
| Loading (first snapshot in flight) | Header from the presence list already in memory; body sections as 3 grey skeleton rows. No spinner. |
| Live, working | All sections; "지금" row's clock ticks once a second. |
| Live, between turns / thinking | "지금" = `도구 실행 없음`; status `생각 중`. |
| Waiting for a person | Status `사람 기다림` in `--warn`, plus one line "권한 요청이 있어요" + button `대화 보기` (answers live in SessionSheet). |
| Empty timeline / no files | One muted line each: `아직 행동이 없어요`, `건드린 파일이 없어요`. Sections stay (no layout jump). |
| Session ended (done/stopped) | Status `끝났어요` (or `멈춤`); clocks freeze; timeline and files stay as last seen while the hub still holds the session in memory. |
| Session removed / unknown id | Body replaced by `이 에이전트를 찾을 수 없어요` + `닫기`. |
| Outside writer (`sid` starts with `outside:`) | Header + status + 건드린 파일 from presence only; other sections replaced by `외부 에이전트라 자세한 진행상황이 없어요`. 대화 보기 hidden. |
| Stream offline | Thin `--warn` bar under the header: `연결이 끊겼어요. 다시 연결하는 중…`; data stays, clocks keep running. |
| Fetch error | Inline `--destructive` text `진행상황을 불러오지 못했어요` + `다시 시도` button. |

Accessibility:
- Status line is `aria-live="polite"` and announces **state changes only** (not every tool). The timeline list is
  not live (it would chatter with 20 agents).
- Focus moves to the ✕ button when the panel opens (it is the first control); Tab order: ✕ → 문서 열기 links →
  대화 보기. All controls are native `<button>`/`<a>` with the app `FOCUS_RING`.
- ✓/✗ and ✎/👁 icons are `aria-hidden` with sr-only text (`성공`, `실패`, `수정함`, `읽음`).
- Contrast: muted text on `--card` already meets 4.5:1 in both themes (index.css comment); status colours are
  always next to a text label, never colour alone.

## 4. Data (server, memory only)

The hub already has most of it: `publicSession` (status, state, stateSince, startedAt, usage, cost, ctx, activity),
`AgentPresence.step`, and every tool call passes through `Hub.push` (`server/dispatch/hub.js:251`).

New, in the per-session runtime record `r` (never in `s`, so the store never saves it):

```ts
// shared/dispatch/live.ts
export type LiveKind = 'read' | 'edit' | 'command' | 'test' | 'build' | 'search' | 'browser' | 'team' | 'other';
export interface LiveAction {
  id: number;          // entry.id of the tool call
  at: number;
  kind: LiveKind;
  label: string;       // activityOf(name, text): "파일 수정", "단위 테스트"
  tool: string;        // tool name without mcp prefix: "Edit", "Bash"
  target: string;      // path (workspace/project-relative) or first line of the command, clip 80, redacted
  ok?: boolean;        // set when the matching tool_result arrives; undefined while running
  endedAt?: number;
}
export interface LiveFile { path: string; edited: boolean; at: number; doc: boolean }  // doc: opens in Atelier
export interface AgentLive {
  sid: string;
  current: LiveAction | null;   // last action with no result yet
  recent: LiveAction[];         // newest first, max 12
  files: LiveFile[];            // newest first, max 30
}
```

- `GET /api/sessions/:id/live` → `AgentLive` snapshot (404 for unknown ids).
- SSE event `live` → `LiveDelta` `{ sid, current?, actions?, files? }`: one coalesced event per session holding only
  what changed (actions upsert by id, files by path; `applyLiveDelta` in `shared/dispatch/live.ts` merges it), at most
  **4 events/s per session** (first change sent at once, the rest flushed after 250ms). With 20 agents that caps at
  ~80 small events/s, far less than the `message` events the stream already carries. The event is broadcast on the
  shared `/api/events` stream (no per-panel subscription on the server); the client drops other sids at once.
- Documents an agent writes through the workspace API (credited by the cursor module) are listed in `files` too.
- Paths outside the project are shown as their basename only; anything matching `.env` is dropped, not shown.

## 5. Client: reusable open API

New folder `web/src/live/`:

```ts
// web/src/live/openAgentLive.ts — the one entry point (sidebar, doc margin, board, #736 diagram node)
export function openAgentLive(sid: string, opts?: { trigger?: HTMLElement | null; from?: LiveFrom }): void;
export function closeAgentLive(): void;
export function useAgentLiveTarget(): string | null;   // which sid is open (for aria-expanded/aria-current on triggers)
export type LiveFrom = 'sidebar' | 'doc' | 'board' | 'node' | 'palette';

// web/src/live/useAgentLive.ts — data for one agent; subscribes to `live` only while mounted
export function useAgentLive(sid: string | null): { live: AgentLive | null; session: Session | null; presence: AgentPresence | null; error: string | null; reload(): void };

// web/src/live/AgentLiveSummary.tsx — compact block (name, model, status, current tool + target, elapsed);
// used in the panel header and by #736's hover card
export function AgentLiveSummary(props: { sid: string; compact?: boolean }): JSX.Element;

// web/src/live/AgentLivePanel.tsx — the panel; mounted once in App.tsx as <AgentLiveHost onOpenFile={openFile} />
```

- Deep link: opening writes `agent=<sid>` into the existing hash (`#file=…&agent=…`) with `replaceState`, so reload
  keeps the panel; closing removes it. The sid is an opaque hub id (no personal data).
- Store is a tiny module store (same pattern as `activity/store.ts`), not React context, so any component and the
  canvas overlay can call `openAgentLive` without a provider.
- File click → `onOpenFile(path)` (the App's `openFile`); the panel stays open.
- `대화 보기` → existing `SessionSheet` (lazy, as in `run/RunStrip.tsx`).

## 6. Entry points

| # | Where | Today | Change |
|---|---|---|---|
| 1 | Sidebar 작업 중인 에이전트 (`web/src/activity/WorkingAgents.tsx`) | Row click opens the agent's file | Row click → `openAgentLive(sid)`. The file keeps a trailing icon button (`SidebarMenuAction`, `FileText` icon, aria-label `{문서} 열기`), visible on hover/focus, so opening the doc stays one click. `aria-expanded` on the row while its panel is open. |
| 2 | Document agent margin (`web/src/doc/MarginPanel.tsx` cards) and project dashboard 지금 작업 중 (`web/src/home/AgentPanel.tsx`) | Card shows status + recent edits; click jumps to the block | Card header (AgentTag + name) becomes a button → `openAgentLive(sid)`; edit rows keep jumping to the block. AgentPanel rows: name → live view, file stays a link. |
| 3 | 세션 보드 (`web/src/dispatch/SessionsPage.tsx` cards) | Card click opens SessionSheet | Card click unchanged. A sibling icon button (`Activity` icon, aria-label `진행상황 보기`, top-right of the card, not nested in the card's button) → `openAgentLive(id)`. SessionSheet header also gets `진행상황 보기`. |
| (#736) | Plan diagram in-progress node | — | Hover: `AgentLiveSummary compact`; click/Enter: `openAgentLive(sid, { from: 'node' })`. |

Entry 1 changes what a sidebar row click does (file → live view). That is the issue's ask ("clicking an agent opens a
live view"); the file stays one click away through the trailing button.

## 7. Smooth with ~20 agents

- Only the open panel subscribes to `live` details; every other surface keeps using the existing presence/session
  events. The client drops `live` events for other sids before touching React state.
- One 1s clock (`setInterval` in the panel only, cleared on close and when `document.hidden`); rows compute elapsed
  from `since`, no per-row timers.
- Timeline capped at 12, files at 30: no virtualisation needed. Rows keyed by action id; a finished action updates
  its ✓/✗ in place instead of re-inserting, so the list doesn't jump.
- New rows appear without animation when `prefers-reduced-motion: reduce`; otherwise a 120ms fade only (no layout
  animation).

## 8. Out of scope

Stopping or messaging the agent from this panel (SessionSheet does that), cost charts, history after the hub forgets
the session, and anything persisted.
