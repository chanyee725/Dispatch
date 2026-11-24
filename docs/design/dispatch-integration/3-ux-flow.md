# 3. UX flow: plan → approve → run → record

Part of the Dispatch → Atelier merge (issue #87). This file covers screens and the order a person moves through them. Data model and server moves are decided in the sibling design files; here only the fields the screens need are named.

## Recommendation (decide these first)

1. **A pipeline is an ordinary Atelier file** with one extra `pipeline` field. Document = the plan in words, canvas = the step diagram, `pipeline` = the machine-readable steps and their run status. No separate "pipeline page". Same file before, during and after the run, so the record is just the file.
2. **The lead writes the plan through a new MCP tool `write_plan`, not by editing JSON on disk.** The server validates the steps, builds the document and the flowchart block from them, and saves through the normal revisioned write. The lead may not create teammates until the user presses **시작하기** (server-enforced, not a prompt rule).
3. **One button, one gate.** The person edits the file freely while it is `계획`. **시작하기** freezes the approved revision and hands it to the lead. Edits after that are notes, not new instructions, until the person presses **계획 다시 열기**.
4. **Running state lives in a 4th view tab `실행`** next to 문서 / 둘 다 / 캔버스, plus a one-line status strip under the top bar in every view. Canvas nodes are coloured by step status, so 캔버스 also shows progress at a glance.
5. **The record keeps metadata only** (step status, times, model, tokens, cost, branch, commit, PR, one-line note). Transcripts stay in `.dispatch/transcripts/` and are never copied into the file, because workspace files get committed.

## Where things are today (evidence)

| What | Where |
|---|---|
| File shape: `title, document, canvas, blocks, revision` | `web/src/api.ts:8-15` |
| Tree rows carry only `title, revision` | `web/src/api.ts:16-18` |
| View tabs 문서 / 둘 다 / 캔버스 | `web/src/TopBar.tsx:3`, `web/src/TopBar.tsx:5`, `web/src/TopBar.tsx:59-72` |
| Banner slot under the top bar (conflict, error) | `web/src/App.tsx:646-670` |
| Sidebar: search, 파일 / 새 폴더 / +, tree, 최근에 지운 파일 | `web/src/Sidebar.tsx:202-266` |
| Diagram block type `flowchart` exists | `web/src/dsl/templates.ts:2`, `web/src/dsl/templates.ts:33` |
| Revisioned save, 409 on stale write, SSE on outside change | `docs/workspace-api.md:9`, `docs/workspace-api.md:20-24` |
| Lead tools: `create_sessions`, `set_task`, `send_message`, `stop_session` | Dispatch `server/mcp.js:55-140` |
| Lead prompt (plan, board stages plan→impl→review→test→merge→done) | Dispatch `server/roles.js:29-46` |
| Board stages and labels 계획/구현/리뷰/테스트/병합 | Dispatch `web/src/lib/steps.ts:4-9`, `web/src/components/TaskBoard.tsx:59-68` |
| 확인 필요 strip, "N분째", "14분 지연" | Dispatch `web/src/components/AttentionStrip.tsx:38-44`, `:80-117` |
| Limit gauges (5시간, 주간, Fable) | Dispatch `web/src/components/ProviderLimits.tsx:50-70` |
| Limit guard saves work as a ticket, resumes after reset | Dispatch `server/sessions.js:710-752`, `server/index.js:249-251` |
| Teammate report arrives as "[이름(역할) 보고 · 브랜치]" | Dispatch `server/roles.js:37`, `server/sessions.js:831-835` |
| Usage counted per session (`input, output, cacheRead, cacheWrite`) | Dispatch `server/sessions.js:460-463`, `:930-936` |
| Transcripts kept outside state, deleted with the session | Dispatch `server/store.js:5`, `server/sessions.js:87-88` |

## States

```
 계획 ──시작하기──▶ 실행 중 ──모든 단계 끝──▶ 완료
  ▲                  │   ▲
  └──계획 다시 열기──┤   └──이어서 하기──┐
                     └──▶ 멈춤 ──────────┘
                          (한도 · 실패 · 사람 기다림 · 멈추기)
```

- `계획` (draft): editable, no teammates exist. The lead may revise with `write_plan`.
- `실행 중`: approved revision frozen; the lead creates sessions per step.
- `멈춤`: limit guard ticket, a failed step, or the lead asking the person. Shows why and the one button that continues.
- `완료`: all steps `done` or `그만둠`. Read-only record; **복제해서 새 계획** makes a fresh draft.

## 1. Entry: from the file list

Recommend: pipeline files live anywhere in the tree (default folder `pipelines/`), marked by a status dot. A small **실행 중 N** chip at the top of the sidebar jumps to them.

```
┌ Sidebar ─────────────────────┐
│ ■ my-workspace               │
│ [ 파일 검색            ]     │
│ ● 실행 중 1   ◐ 계획 1       │  ← chips, hidden when 0; click = filter
│ 파일              새 폴더  + │  ← "+" menu: 새 파일 / 새 파이프라인
│ ▾ pipelines                  │
│    ● 로그인 개편       12분째│  ← green dot = 실행 중, time in state
│    ◐ 내보내기 PDF      계획  │  ← hollow = 계획 (needs you)
│    ✓ 캔버스 프레임     완료  │
│ ▸ docs                       │
│   아키텍처 메모              │
│ ─────────────────────────────│
│ [ 최근에 지운 파일 ]          │
└──────────────────────────────┘
```

- Needs: tree rows gain `pipeline?: { state, since }` (`web/src/api.ts:16-18`); the server reads it from the file head, no full parse per row.
- **+ → 새 파이프라인** makes an empty draft with a template (목표 / 단계 / 위험) and the step diagram block. Normally the lead makes it; the menu item is for writing one by hand.
- A `계획` file the person has not opened since the lead wrote it shows a bold title (same as an unread mark). No browser notification for drafts; notifications stay for 실행 중 problems (Dispatch rules, README "알림").

## 2. The lead writes the plan

### Proposed change to the lead rules

Replace the first bullet of "Lead (관리자) only" in `skills/dispatch-team/reference/rules.md` and the planning part of `SPAWN_PROMPT` (`server/roles.js:29-46`) with:

> - Before creating any teammate, write the plan with `write_plan`: goal, steps (title, role, model, effort, depends on, files touched, done-when), risks, and what you need from the user. One step per future implementer; split so two steps never touch the same files.
> - Then end your turn with one line: the plan's file path and "검토 후 시작하기를 눌러 주세요". Do not create sessions; the server refuses `create_sessions` until the plan is approved.
> - After approval you get "[계획 승인 · rev N]" with the person's edits since your draft. Follow the approved revision. Use `set_task` with `step: <step id>` so the board and the file stay one list.
> - Small fixes (1–2 files) may skip the plan: `write_plan` with one step and `autostart: true`; the server still shows it in the file list.

### New and changed MCP tools (lead only)

| Tool | Does |
|---|---|
| `write_plan { path?, folder?, goal, steps[], risks[], asks[] }` | Creates or updates the draft; returns `path`, `revision`. Refused once the plan is `실행 중`. A new plan without `path` goes to `<folder>/pipelines/`: `folder` (an existing top-level workspace folder, else 400), else the lead's project folder, else the one top-level folder every step's `files` sits in, else top-level `pipelines/` (#726). |
| `set_task { …, step }` | Existing tool (`server/mcp.js:112-135`) gains `step`; status, owner and stage show on that step in the file. |
| `note_step { step, text }` | One plain line the record keeps (e.g. "리뷰 must-fix 1건 고쳐서 다시 올림"). Max 200 chars, no transcript text. |
| `create_sessions` | Refused with "계획 승인 전이에요" while the lead's plan is `계획`. |

### What `write_plan` puts in the file

```
문서 (left)                              캔버스 (right)
┌────────────────────────────────┐      ┌──────────────────────────────────┐
│ # 로그인 개편                   │      │  flowchart block (generated)     │
│ 목표: 매직 링크로 로그인해요      │      │                                  │
│ ## 단계                         │      │  [1 서버 API]──▶[3 리뷰]──▶[4 병합]│
│ 1. 서버 API — 구현자 · sonnet    │      │  [2 로그인 화면]─┘               │
│    끝: auth.test 통과           │      │                                  │
│ 2. 로그인 화면 — 구현자 · sonnet │      │  each node: 제목 / 역할 · 모델    │
│ 3. 리뷰 — 리뷰어 · opus         │      │                                  │
│ ## 위험                         │      │                                  │
│ - 세션 쿠키 이름이 바뀌어요       │      │                                  │
│ ## 사용자에게 물어볼 것           │      │                                  │
│ - 링크 유효 시간은 15분이면 될까요?│      │                                  │
└────────────────────────────────┘      └──────────────────────────────────┘
```

- The step list in the document is a generated block (like `diagram`/`frameEmbed`, `web/src/doc/model.ts:9`, `:14`) bound to `pipeline.steps`, so editing a row edits the step. Free text around it is the person's.
- The flowchart block is regenerated from steps while `계획`; the person may drag nodes (layout edit) and the layout survives regeneration by step id.

## 3. Review, edit and start

The person opens the draft. A strip under the top bar (banner slot, `web/src/App.tsx:646`) carries the gate:

```
┌ TopBar: 로그인 개편 · 저장됨      [문서|둘 다|캔버스|실행]  버전 기록  내보내기 ┐
├────────────────────────────────────────────────────────────────────────────┤
│ ◐ 계획이에요. 고칠 곳을 고친 뒤 시작해 주세요.   예상 4세션 · 약 40분   [시작하기] │
└────────────────────────────────────────────────────────────────────────────┘
```

Editing a step row in the document opens an inline editor (same pattern as block props, `web/src/BlockProps.tsx`):

```
┌ 단계 2 ─────────────────────────────────────────┐
│ 제목   [ 로그인 화면                         ]  │
│ 역할   [ 구현자 ▾ ]  모델 [ sonnet ▾ ]  강도 [ 보통 ▾ ] │
│ 먼저   [x] 1 서버 API                           │
│ 끝     [ e2e login.spec 통과                 ]  │
│                                [ 단계 지우기 ]  │
└─────────────────────────────────────────────────┘
```

**시작하기** opens a short confirm, because it spends limits:

```
┌ 이 계획으로 시작할까요? ───────────────────────┐
│ 세션 4개 · Claude 5시간 한도 62% 사용 중        │
│ 바뀐 점: 단계 2 모델 opus → sonnet, 단계 5 추가  │
│ 물어볼 것 1개에 답이 없어요. 그래도 시작할까요?   │
│                          [취소]  [시작하기]    │
└────────────────────────────────────────────────┘
```

- Blocks start (button disabled, reason in a tooltip) when: no steps, a step without role, a dependency cycle, a model whose provider is not connected, or the limit guard is hit ("한도에 가까워서 지금은 못 시작해요. 3시 10분에 초기화돼요").
- "바뀐 점" is the diff between the lead's last `write_plan` revision and now; it is also what the lead receives in "[계획 승인 · rev N]".
- Approval records `approvedRevision` and time only. No person's name is stored (single local user).

## 4. While it runs

### Status strip (every view)

```
│ ● 실행 중 · 3/5 단계 · 24분째 · $1.82 · 5시간 68%    [실행 보기] [멈추기] │
│ ⚠ 확인 필요 1 · Juno(구현자)가 답을 기다려요 · 4분째        [열기]        │  ← only when needed
```

### `실행` view

Three columns at ≥1280px; stacks vertically below 768px (same breakpoint as `narrow` in `web/src/App.tsx`).

```
┌ 단계 ─────────────────┬ 세션 ─────────────────────────┬ 한도 ───────────┐
│ ✓ 1 서버 API     12분 │ Juno  구현자 · sonnet  ● 작업중│ Claude 5시간 68%│
│ ● 2 로그인 화면  8분째│   dispatch/impl-2 · 3커밋      │ ▓▓▓▓▓▓▓░░░      │
│   Juno · 구현 단계    │   지금: npm test 실행 · 2분째   │ 주간 41%        │
│ ◌ 3 리뷰    기다려요  │   $0.64 · 1.2M 토큰 · 맥락 38% │ ▓▓▓▓░░░░░░      │
│ ◌ 4 병합    기다려요  │ Cal   관리자 · sonnet  ○ 쉼    │ Fable  —        │
│ ⚠ 5 문서    막힘      │   마지막: "단계 2 리뷰 붙였어요"│                 │
│   "e2e 3번 연속 실패" │ Sam   리뷰어 · opus    ◌ 대기  │ 지금 시간당 $4.1│
│                       │                                │ 한도 가까우면 막기│
│                       │ [세션 추가] [끝난 세션 정리]    │   90% 켜짐      │
├───────────────────────┴────────────────────────────────┴─────────────────┤
│ 기록 (최근 순)                                                             │
│ 14:32 Juno 보고 · dispatch/impl-2 — 로그인 폼 붙였어요, e2e 1개 남았어요    │
│ 14:20 Cal  단계 1 병합 · develop 3f2a1c0 · PR #91                          │
│ 14:05 승인 · rev 7                                                         │
└───────────────────────────────────────────────────────────────────────────┘
```

- **단계** column = `pipeline.steps` joined with board tasks by `step` (stages from Dispatch `web/src/lib/steps.ts:4-9`; time text from `TaskBoard.tsx:59-68`).
- **세션** column = Dispatch session cards trimmed to: name, role, model, state, branch, "지금 …" activity, cost, tokens, context %. Click opens the session sheet (transcript) in a side drawer; the transcript is read from Dispatch's store, never written into the file.
- **한도** column = Dispatch `ProviderLimits` and the guard switch. When the guard fires, the step shows "한도로 멈춤 · 3시 10분에 이어요" and the strip turns amber.
- **기록** = report headlines only: who, branch, first line of the report (≤120 chars), merges with commit/PR. This list is what the file keeps afterwards.
- Answering a question or permission happens in the drawer (Dispatch `AnswerCard`), not in the strip.

### Canvas during the run

Nodes of the generated flowchart get a status colour and a small badge (`●` 실행 중, `✓` 완료, `⚠` 막힘, `◌` 기다림). The node shape and layout do not move during a run; only colour changes, so the person keeps their mental map. The diagram code is not rewritten during a run (status is an overlay, not DSL).

### Editing during a run

The document stays editable (notes). Step rows are read-only with the hint "실행 중이라 바꿀 수 없어요. 바꾸려면 멈추고 계획 다시 열기를 눌러 주세요." **멈추기** asks the lead to commit WIP and hand off (existing limit-handoff rule), then the file goes to `멈춤`.

## 5. After it ends

The file opens on `문서` with a summary block the server writes at `완료`:

```
┌ ✓ 완료 · 11월 13일 14:05–15:12 (1시간 7분) ─────────────────────────┐
│ 단계 5개 · 세션 6개 · $4.90 · 9.8M 토큰 · 병합 3건 (PR #91 #92 #94)   │
├──────────────┬────────┬─────────┬────────┬────────┬─────────────────┤
│ 단계          │ 역할    │ 모델     │ 걸린 시간│ 비용   │ 결과             │
│ 1 서버 API    │ 구현자  │ sonnet  │ 18분    │ $0.92  │ develop 3f2a1c0 │
│ 2 로그인 화면 │ 구현자  │ sonnet  │ 31분    │ $1.40  │ PR #92          │
│ 5 문서        │ 문서화  │ haiku   │ —       │ —      │ 그만둠          │
└──────────────┴────────┴─────────┴────────┴────────┴─────────────────┘
  계획과 달라진 점: 단계 5 그만둠 ("README는 다음 PR에서")   [복제해서 새 계획]
```

- `실행` tab stays and shows the same three columns frozen at the end (sessions as rows with final numbers; no live drawer, since finished sessions are removed by the lead).
- **버전 기록** (`web/src/HistoryDialog.tsx`) already shows the draft → approved → done revisions; label those three versions "계획 초안", "승인", "완료" so the person can compare plan vs. result.
- The file is read-only in `완료` except free document text. Re-running means **복제해서 새 계획**.

## 6. Build order (screens)

1. `pipeline` field + tree badge + 새 파이프라인 template (no Dispatch yet). ~1 day.
2. `write_plan` / `create_sessions` gate + 시작하기 strip and confirm. ~1–2 days.
3. Status strip + `실행` view (단계, 세션, 기록) + canvas status overlay. ~2–3 days.
4. 한도 column, 멈춤/이어서 하기 with tickets. ~1 day.
5. 완료 summary block, version labels, 복제해서 새 계획. ~1 day.

## Open questions

1. Is approval per plan only, or should some steps (merge into `develop`, push) need a second 확인 in the run? Current Dispatch rules already route push through the person.
2. Where do the run's Dispatch screens go for projects that are not Atelier workspaces: keep Dispatch's own board, or require every run to start from a Atelier file?
3. Should the record show cost in dollars, or tokens only? Dollars help, but the same file may be shared with people who should not see spend.
4. Can the person write a plan by hand and start it without a lead (Atelier creates the lead with the plan as its task)? Recommended yes, after step 3 of the build order.
5. Pipeline file location: free anywhere with a dot badge (recommended), or a fixed `pipelines/` folder the sidebar shows as its own section?
