# 설정 > 모드별 모델 (mode × role profiles)

Issue #748. Design spec for the settings UI (PR 3). Server side is PR 1 (#751, `server/dispatch/mode-profiles.js`, the source
of truth for modes, defaults, hints and fallback); the last section restates its API for the UI. Mockup: `mode-profiles/mockup.html` (static, not app code); screenshots
`mode-profiles/desktop-build.png` (800 px dialog, 구현 tab, Codex not connected; the mockup URL says `?mode=build`, the real mode id is `impl`) and
`mode-profiles/narrow-research.png` (390 px, 조사 tab).

## Where it goes

- Replaces the 역할별 모델 section (`web/src/settings/sections/RolesSection.tsx`). Nav label becomes 모드별 모델.
  The section id can stay `roles` so `useDirtyMark('roles', …)` and the close-confirm keep working.
- Reuse, don't fork: `SectionFrame`, `LoadNote` / `OffNote`, `PRIMARY_BTN`, `NativeSelect`, `ProviderIcon`,
  `modelGroups` / `roleChoice` / `subjParticle` from `modelsSection.ts`, `permsFor` / `fitPerm` from
  `dispatch/lib/create.ts`, `permLabel` from `dispatch/lib/format.ts`, Radix `Tabs` from `components/ui/tabs.tsx`.
- Do not touch 모델 연결 (`ProvidersSection`, #747) or the session board (#731).

## Layout

```
모드별 모델                                    (h3, SectionFrame)
팀이나 플랜 단계를 시작할 때 고른 모드의 설정을 써요. …   (hint)
[계획/설계 •][구현][리뷰·테스트][문서][빠른 수정][조사]   (tablist, one row)
기능을 만들고 고치는 기본 모드예요.                       (mode description)
        모델                       생각 수준   권한        (column heads, md+ only)
관리자  [◆ Sonnet 5.5          ▾] [기본   ▾] [자동      ▾]
        ⚠ <fallback note, only when needed>
        잘하는 것 [빠른 수정·문서                      ]
구현자  …  (6 role rows)
──────────────────────────────────────────────────────── (sticky footer)
<status text>                          [이 모드 기본값으로] [저장]
```

- Tabs: `TabsList` default (muted pill) look, `h-8`, triggers `h-7 px-2.5`. One row, never wrap: the list
  scrolls horizontally (`overflow-x-auto`, `flex-none` triggers, hidden scrollbar) and the selected tab is
  scrolled into view on change (`scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' })`).
  Selection follows focus (Radix default `activationMode="automatic"`): panels are local state, instant.
- A tab whose mode has unsaved edits shows a 6 px dot after its label plus sr-only `(바뀜)`.
- Role grid (md+): CSS grid `grid-cols-[4.5rem_minmax(0,1fr)_6rem_9.5rem] gap-x-2 gap-y-1 items-center`.
  Controls `h-8`, text `text-sm`. Second line of a row (note + 잘하는 것) spans columns 2–4, `mb-2.5` between rows
  so the gap between roles is larger than inside a role.
- Narrow (< md): the role name on its own line, model full width, then 생각 수준 | 권한 in two columns, each with
  its own visible small label (column heads are hidden). All controls `h-11`. Same order in DOM and on screen.
- Footer: sticky at the bottom of the section body (`sticky bottom-0 bg-background border-t`), status text left
  (`role="status"`), buttons right. Buttons `h-8` (`h-11` narrow).

## Cell controls

What a cell shows: the user's `cell` when set, else `defaults[mode][role]` (built-in first choice), from
GET /api/mode-profiles. `resolved` is what a team started now would really get.

| Control | Content | Notes |
| --- | --- | --- |
| 모델 | Native `<select>` with `<optgroup>` per provider, the same picker as today (#621/#672): an unconnected provider's group is disabled with `· 연결 안 됨` in its label; a saved model no longer listed stays as its own first option (not sendable until changed: the server only accepts listed models). `ProviderIcon` before the select. | Changing the model resets 생각 수준 to 기본 and fits 권한 with `fitPerm` (Codex: plan/auto only), like 새 세션. Sent with the model's provider id (`claude`/`openai`/`gemini`). |
| 생각 수준 | `기본` + the model's `efforts`. | 기본 = `effort: null`. |
| 권한 | `permsFor(provider)` with `permLabel`. Never offers anything looser than the provider allows; no bypass. | |
| 잘하는 것 | `<input type="text" maxlength="40">`, visible label 잘하는 것. | **Per model, not per cell** (server `hints`, keyed by model id; Codex and Gemini by provider). Editing it in one cell changes it in every cell with that model. One line under the mode description says so for the whole panel (`잘하는 것은 모델마다 하나예요. 고치면 그 모델의 모든 칸에 같이 바뀌어요.`), and every hint input points at it with `aria-describedby`. A user-set hint shows a small `직접 씀` tag; clearing it (or `null`) brings the built-in text back. |

Built-in hints (`DEFAULT_HINTS`): Fable `복잡한 작업`, Opus `구현`, Sonnet `빠른 수정·문서`, Haiku `짧은 일`,
OpenAI Codex `서치·자료 수집`, Gemini `긴 문맥`.

## States

| State | What shows |
| --- | --- |
| Loading / stream dropped | `LoadNote`; picks stay on screen (#644). |
| Dispatch off | `OffNote`, whole fieldset `disabled` + `opacity-60`, as today. |
| Fallback in use (`resolved.note` not null) | Select gets `aria-invalid` + warn border; note under it with ⚠ (not colour alone) showing `resolved.note` as the server writes it: `대신 <모델>: <사유>` (e.g. `대신 claude-opus-5-5: OpenAI Codex 연결 안 됨`). The UI may swap the model id for its label when listed; it never rewrites the reason. Saving is still allowed. |
| Cross-check fallback (`note` starts with `구현자와 다른 모델이 없어`) | Same note pattern, muted colour (no warn border): it is informational, the team still works. |
| Unsaved edits | Tab dot; status `계획/설계 모드에 저장하지 않은 변경이 있어요.` (names the first other dirty mode, or nothing when only the open mode is dirty). Close asks first (existing `useDirtyMark`). |
| Saved | Re-read GET and show `저장했어요.`; a 400 → `text-destructive` with the server message (already 해요체). Nothing changed → `바뀐 게 없어요.` |

## Reset

- `이 모드 기본값으로` (secondary button): shows every cell of the open mode as its built-in default. Not saved until
  저장, so no confirm dialog; status says `계획/설계 모드를 기본값으로 돌렸어요. 저장하면 적용돼요.` Disabled when the mode
  has no stored cells and no local edits. Hints are per model, so a mode reset leaves them alone.
- On 저장: a reset mode with no later edits sends `{ reset: "<mode>" }`; otherwise its changed cells go in `cells`
  (`null` for a cell back to default).
- No "reset all" button in v1 (the API's `{ reset: true }` also clears hints; keep it for a later issue).
- Fallback order is built-in and fixed (decided): the UI shows it nowhere except through `resolved.note`.

## Copy (해요체)

- Section hint: `팀이나 플랜 단계를 시작할 때 고른 모드의 설정을 써요. 연결한 제공사의 모델이면 어느 것이든 고를 수 있어요.`
- Mode descriptions: 계획/설계 `큰 그림과 설계를 잡는 모드예요.` · 구현 `기능을 만들고 고치는 기본 모드예요.` ·
  리뷰·테스트 `만든 것을 다른 눈으로 확인하는 모드예요.` · 문서 `문서를 쓰고 다듬는 모드예요.` ·
  빠른 수정 `작은 수정을 빨리 끝내는 모드예요.` · 조사 `웹 서치와 자료 모으기에 맞춘 모드예요.`
- Role names come from the server's roles (관리자, 구현자, 리뷰어, 테스터, 디자이너, 문서화).

## Accessibility

- Tabs: Radix `Tabs` gives `role=tablist/tab/tabpanel`, `aria-selected`, roving focus with ←/→/Home/End. Tablist
  `aria-label="모드"`; triggers are `<button type="button">` (inside the form, must not submit). Selected state
  is not colour alone: border + background (existing trigger style).
- Each role row is a `<fieldset>` with an sr-only `<legend>` = role name (`display: contents` on md+ so it can sit
  in the grid). Every control has a real label: model `<label>` = role name; 생각 수준 / 권한 via
  `aria-labelledby="<column head id> <legend id>"` on md+, visible `<label>` on narrow (render both, hide by
  breakpoint, or always use visible labels; never placeholder-only).
- Warnings: `aria-invalid` + `aria-describedby` to the note id; ⚠ is `aria-hidden`, text carries the meaning.
- Focus: `focus-visible:ring-2 ring-ring` on every control (existing `FOCUS`). Tab order: tablist → panel
  controls row by row → reset → 저장.
- Contrast: only existing tokens (`muted-foreground` on `background` ≥ 4.5:1, `warn` for warnings, `ring` ≥ 3:1).
- Targets ≥ 44 px on narrow (`max-md:h-11`).

## Defaults grid (built-in, from `DEFAULT_GRID`)

First choice → fallback. `GPT` = the first model OpenAI Codex lists. `cross` = 리뷰어/테스터 skip the implementer's
model of the same mode while another choice works. 권한 is the role preset's (`auto`).

| Mode | 관리자 | 구현자 | 리뷰어 | 테스터 | 디자이너 | 문서화 |
| --- | --- | --- | --- | --- | --- | --- |
| plan 계획/설계 | Fable 5.2 → Opus | Fable 5.2 → Opus | GPT → Opus (cross) | GPT → Opus (cross) | Fable 5.2 → Opus | Sonnet |
| impl 구현 | Sonnet | Opus | GPT → Opus (cross) | GPT → Opus (cross) | Sonnet | Sonnet |
| review 리뷰·테스트 | Sonnet | Opus | GPT → Opus (cross) | GPT → Opus (cross) | Sonnet | Sonnet |
| docs 문서 | Sonnet | Sonnet | GPT → Opus (cross) | GPT → Opus (cross) | Sonnet | Sonnet |
| quickfix 빠른 수정 | Sonnet | Sonnet (low) | GPT → Opus (cross) | GPT → Sonnet (cross) | Sonnet | Sonnet |
| research 조사 | GPT → Sonnet | GPT → Opus | GPT → Opus (cross) | GPT → Opus (cross) | Sonnet | Sonnet |

## API and storage (PR 1, #751)

- Stored in `~/.dispatch/drawing.json` top-level `modeProfiles`, only what the user changed:
  `{ "cells": { "<mode>": { "<role>": { "provider", "model", "effort", "perm" } } }, "hints": { "<model id or provider>": "text" } }`.
  `provider` is the stored id `claude` | `openai` | `gemini` (the server also accepts `codex` / `agy` on input).
- Mode ids: `plan`, `impl`, `review`, `docs`, `quickfix`, `research` (default `impl`). Role ids as in
  `server/dispatch/roles.js`. Hints ≤ 40 chars, plain text, no personal data.
- `GET /api/mode-profiles` → `{ modes, roles, defaults, hints, stored, grid[mode][role]: { cell, resolved, hint } }`.
- `PUT /api/mode-profiles` (header `x-drawing: 1`), one of: `{ cells: { <mode>: { <role>: cell | null } } }`,
  `{ hints: { <key>: text | null } }`, `{ reset: true | "<mode>" }`. 400 with a 해요체 message on a bad value.
- Resolver order per cell: the user's cell → the built-in chain → 설정's `team.roleModels[role]` → the role preset's
  model. The first choice whose provider is connected and whose model is listed wins; skipped choices become
  `note` = `대신 <model>: <reasons>`.
