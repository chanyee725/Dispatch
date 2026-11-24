# 5. Design system review: a Linear-like direction

Status: draft for review (design only, no code changed). Scope: the Drawing web app after Dispatch is merged in
(#87). Written from the repo, the Dispatch clone (`web/`, read only) and the WIP `748f6a4` on `feat/shadcn-ui`
(read with `git show`). No external sites were opened; anything said about Linear is general knowledge of its
public look, not measured values.

## 0. Recommendation (read this first)

1. **Base: shadcn/ui (Radix + Tailwind v4) with our own "Linear-like" token layer.** Both codebases already sit
   on Tailwind v4, and Dispatch already ships shadcn/ui new-york with oklch tokens
   (`Dispatch/web/components.json:1-7`, `Dispatch/web/src/index.css:9-43`). One token file serves both apps.
2. **Dark first, light kept.** Default to the OS, but tune dark first. Three surfaces + one 1px border step,
   low-contrast grey ramp, no accent hue: primary, focus and selection are neutral (shadcn stock, doc 6 §4.1).
3. **Type (superseded by doc 6 §4.2: Pretendard only, UI 14px, document body 16px).** First draft: Inter Variable 13px for UI, 15px for the document body, Pretendard as the Korean fallback. Bundle
   both as files (no CDN), per CLAUDE.md.
4. **Density: 28px rows/controls, 4px grid, 6px radius, almost no shadows** (only on floating layers).
5. **Command menu at the centre:** keep `Ctrl/Cmd+K` (`web/src/App.tsx:496`) and rebuild it on `cmdk`, so every
   action (files, views, export, Dispatch sessions) is reachable without the mouse.
6. **Reuse the WIP in parts, not as-is** (section 8): take `lib/utils.ts`, the `ui/*` sources and the dark-mode
   variant; replace the Zinc token block and fix the broken legacy variables before merging.
7. **Two looks, one boundary (user decision, 2026-11-13).** The Linear-like look is for the app chrome only
   (sidebar, top bar, menus, dialogs, Dispatch screens). The canvas and diagram blocks follow one rule: **look the
   same as Eraser** (section 5). Eraser's name, logo, icon/illustration/font files and code are still never copied.

## 1. What exists today

| Area | Drawing (`web/`) | Dispatch (`Dispatch/web/`) |
|---|---|---|
| Tokens | 9 hex vars, light/dark (`web/src/index.css:4-27`) | shadcn oklch set + status/role colours (`index.css:9-71`), plus a dark "monitor" theme (`index.css:134-157`) |
| Theme switch | `data-theme` light/dark (`web/src/theme.ts:3,19`) | `.dark` class, choice system/light/dark/monitor (`store.ts:4`) |
| Font | `14px system-ui` (`web/src/index.css:34`) | Pretendard Variable, `ss06` (`index.css:75,110`) |
| Components | hand-made, inline `style={{ var(--…) }}` (e.g. `Sidebar.tsx:206`, `CommandPalette.tsx:72`) | shadcn/ui on the unified `radix-ui` package (`ui/dialog.tsx:4`) |
| Command menu | own listbox, `Ctrl/Cmd+K` (`App.tsx:491-500`, `CommandPalette.tsx:55-115`) | none |
| Canvas | Excalidraw, `theme` prop light/dark (`canvas/ExcalidrawCanvas.tsx:39,665`) | none |

Observations:

- Drawing already has the right bones (thin borders, muted text; its accent colour goes away) but no scale: sizes are
  scattered (`h-8`, `h-12`, `text-sm`, 14/15/13/12px) and shadows are ad hoc (`index.css:136,174`).
- Dispatch's monitor theme is already the closest thing to Linear in either repo: dark, flat panels, thin
  borders, small radius (`Dispatch/web/src/index.css:134-147`). Its status colours (`--ok/--warn/--bad/--idle`)
  and role lanes (`--role-*`) are worth keeping as semantic tokens.
- About 120 inline `var(--…)` uses across 14 files in Drawing (`grep var\(-- web/src`); a rename must keep
  aliases or touch all of them at once.

## 2. What "Linear-like" means here

Traits we want, as rules we can check:

| Trait | Rule for us |
|---|---|
| Dark first | Dark tokens are designed first; light is derived and checked second |
| Dense | Default row/control 28px, compact 24px; sidebar 220px; top bar 44px |
| Thin borders | Always 1px; in dark, white at 6–10% alpha instead of a solid grey |
| Low-contrast greys | 4 text steps, 3 surface steps; surfaces differ by ~2–3 L in oklch |
| Pretendard 14px (doc 6 §4.2) | first draft: UI 13px/20px, meta 12px/16px, titles 14–15px 600; tabular numbers on counts and times |
| Keyboard first | Every action has a command entry; shortcuts shown as `kbd` in menus; visible focus ring |
| Command menu centre | `Ctrl/Cmd+K` opens one menu for navigation + actions; context menus reuse its items |
| Quiet colour | Colour only means something: accent = focus/selection, status/role = information |

What we do **not** copy: Linear's logo, wordmark, icon set, illustrations, exact colours, layouts of specific
screens, or marketing gradients (section 7).

## 3. Token draft

> **Colour values superseded (2026-11-13, #122):** both columns below are replaced by the stock shadcn/ui neutral
> theme in [6-app-shell-projects.md §4](6-app-shell-projects.md) (no custom greys, no accent hue; colour only for
> status). Type moved to Pretendard only at about 108% (doc 6 §4.2). The status and role colours below still apply.

Names follow shadcn so `ui/*` works unchanged; extras are ours. Values are oklch, pure neutral (chroma 0). Superseded
by doc 6 §4.1; kept only as a record of the first draft.

### 3.1 Colour

| Token | Dark (superseded, see doc 6 §4.1) | Light (superseded) | Use |
|---|---|---|---|
| `--background` | `oklch(0.16 0 0)` | `oklch(0.99 0 0)` | app frame, doc page |
| `--panel` (new) | `oklch(0.185 0 0)` | `oklch(0.975 0 0)` | sidebar, top bar, inspector |
| `--card` / `--popover` | `oklch(0.21 0 0)` | `oklch(1 0 0)` | menus, dialogs, cards |
| `--muted` / `--secondary` | `oklch(0.24 0 0)` | `oklch(0.955 0 0)` | inputs, segmented bg, code |
| `--accent` (shadcn: hover row) | `oklch(1 0 0 / 5%)` | `oklch(0 0 0 / 4%)` | hover, selected row bg |
| `--border` | `oklch(1 0 0 / 8%)` | `oklch(0.91 0 0)` | every 1px line |
| `--border-strong` (new) | `oklch(1 0 0 / 14%)` | `oklch(0.86 0 0)` | input, focus-less outlines |
| `--foreground` | `oklch(0.94 0 0)` | `oklch(0.2 0 0)` | primary text |
| `--text-2` (new) | `oklch(0.78 0 0)` | `oklch(0.38 0 0)` | secondary text |
| `--muted-foreground` | `oklch(0.62 0 0)` | `oklch(0.53 0 0)` | meta, placeholders |
| `--text-4` (new) | `oklch(0.48 0 0)` | `oklch(0.68 0 0)` | disabled, hints |
| `--primary` | see doc 6 §4.1 | see doc 6 §4.1 | primary button (neutral) |
| `--ring` / focus | see doc 6 §4.1 | see doc 6 §4.1 | 2px focus ring (neutral) |
| `--destructive` | `oklch(0.68 0.19 25)` | `oklch(0.58 0.21 25)` | errors, delete |
| `--ok --warn --bad --idle` | from Dispatch dark/monitor (`index.css:60-63,153-156`) | from Dispatch light (`index.css:30-33`) | session status |
| `--role-*` | Dispatch dark (`index.css:65-70`) | Dispatch light (`index.css:35-40`) | agent role lanes |
| `--dot` | `oklch(1 0 0 / 7%)` | `oklch(0.86 0 0)` | canvas grid |

`--accent` is shadcn's neutral hover colour. There is no accent hue (2026-11-13); section 8 covers migrating today's `--accent` call sites.

### 3.2 Type

| Token | Value |
|---|---|
| `--font-sans` | `"Pretendard Variable", Pretendard, system-ui, sans-serif` (doc 6 §4.2; Inter dropped) |
| `--font-mono` | `ui-monospace, "JetBrains Mono", Menlo, monospace` (system only; nothing new to bundle) |
| `text-xs` | 12px / 16px, meta, kbd, badges |
| `text-sm` (UI default) | 13px / 20px |
| `text-base` | 14px / 20px, dialog titles, top bar title |
| `text-doc` | 15px / 1.65, document body (as today, `index.css:52-53`) |
| `text-lg` | 18px / 24px 600, page headers (settings, usage) |
| weights | 400 body, 500 labels/buttons, 600 titles; no 700 in UI chrome |
| tracking | `-0.01em` at 13px+, `0` at 12px |
| features | `cv11` (single-storey a), `tnum` via `.num` on counts, costs, times |

Korean: Inter has no Hangul, so Hangul falls through to Pretendard (Dispatch already bundles it,
`Dispatch/web/package.json` → `pretendard`). Check Hangul at 13px in a headless screenshot; Pretendard's
x-height is close to Inter's, so mixing should hold.

### 3.3 Spacing, size, radius, shadow, motion

| Group | Tokens |
|---|---|
| Spacing | 4px grid: 2, 4, 6, 8, 12, 16, 24, 32 (Tailwind 0.5–8 already maps) |
| Control height | `--h-row: 28px` (buttons, inputs, list rows), `--h-compact: 24px`, `--h-bar: 44px` |
| Layout | sidebar 220px (today `w-60` = 240, `Sidebar.tsx:206`), inspector 280px, doc column max 720px |
| Radius | `--radius: 6px`; sm 4px (badges, kbd, rows), md 6px (buttons, inputs), lg 8px (menus, dialogs), full for dots |
| Shadow | none on panels; `--shadow-pop`: dark `0 0 0 1px var(--border), 0 8px 24px oklch(0 0 0 / 40%)`, light `0 0 0 1px var(--border), 0 8px 24px oklch(0 0 0 / 10%)`; dialogs add a 50% scrim |
| Motion | 120ms ease-out for hover/menus, 160ms for dialogs; respect reduced motion (as Dispatch, `index.css:118-120`) |
| Focus | 2px `--ring` outline, 1px offset; never remove without a replacement |

## 4. Screen sketches (dark, 13px)

### 4.1 File view (doc + canvas, today's main screen)

```
┌──────────────┬───────────────────────────────────────────────────────────────────────┐
│ ▣ Drawing  ⌄ │ ☰  결제 흐름 설계            ● 저장됨     [문서|둘 다|캔버스]   ⌘K  ⤓  ⋯ │ 44px
│ ⌕ 검색    ⌘K │───────────────────────────────────────┬───────────────────────────────│
│              │  # 결제 흐름                           │  · · · · · · · · · · · · · ·  │
│ 파일          │  결제 요청은 API 게이트웨이를 지나요.     │  · ┌───────┐ · · ┌───────┐ · │
│ ▸ docs       │                                       │  · │ Client├──────▶│  API  │ · │
│   결제 흐름 ◀ │  ┌─────────────────────────────┐      │  · └───────┘ · · └───┬───┘ · │
│   온보딩     │  │  (diagram picture)          │      │  · · · · · · · · · · │ · · · │
│ ▸ infra      │  └─────────────────────────────┘      │  · · · · · · · ┌─────▼───┐ · │
│              │  - [ ] 재시도 정책 정하기               │  · · · · · · · │   DB    │ · │
│ 파이프라인     │                                       │  · · · · · · · └─────────┘ · │
│ ● impl  2    │                                       │ ┌─────────────────────┐      │
│ ○ review     │                                       │ │ ▢ ◯ ↗ T ✎ ⌫   …    │      │
│──────────────│                                       │ └─────────────────────┘      │
│ 🗑 휴지통      │                                       │                              │
└──────────────┴───────────────────────────────────────┴───────────────────────────────┘
 220px panel     doc column max 720px, 15px body          Excalidraw, our toolbar skin
```

Sidebar rows 28px, section labels 12px `--muted-foreground`, active row `--accent` + `--foreground`.
Status in the top bar is a 6px dot + 12px text (the WIP already did this, `748f6a4:web/src/TopBar.tsx`).

### 4.2 Command menu (`Ctrl/Cmd+K`)

```
            ┌──────────────────────────────────────────────────┐
            │ ⌕  명령이나 파일 이름을 입력해요                  │ 44px input, no border inside
            │──────────────────────────────────────────────────│
            │ 파일                                              │ 12px group label
            │ ▤ 결제 흐름 설계                     docs/        │ 32px rows
            │ ▤ 온보딩                             docs/        │
            │ 동작                                              │
            │ ⊕ 새 파일                                   ⌘N   │
            │ ⇄ 보기: 캔버스만                            ⌘3   │
            │ ⤓ PNG로 내보내기                            ⌘E   │
            │ 파이프라인                                         │
            │ ▶ 실행: 결제 흐름 설계                              │
            │ ◉ 세션 보기: impl-2                ● 작업 중       │
            │──────────────────────────────────────────────────│
            │ ↑↓ 이동   ↵ 실행   esc 닫기                         │ 12px footer hints
            └──────────────────────────────────────────────────┘
             560px, top 15vh, --popover, --shadow-pop, radius 8px
```

### 4.3 Pipeline / sessions board (from Dispatch)

```
┌──────────────┬──────────────────────────────────────────────────────────────────────┐
│ (sidebar)    │ 세션  6   ● 작업 중 3  ◌ 대기 2  ✕ 실패 1          필터 ⌄   + 새 세션 C │
│              │──────────────────────────────────────────────────────────────────────│
│              │ ● lead      관리자   계획 정리 중                  12분   $0.42  ⋯   │ 28px rows
│              │ ● impl-2    구현자   feat/foo 테스트 실행           3분   $0.18  ⋯   │
│              │ ◌ review-1  리뷰어   대기                           —     $0.00  ⋯   │
│              │ ✕ test-1    테스터   npm test 실패 (2)             1분   $0.05  ⋯   │
│              │──────────────────────────────────────────────────────────────────────│
│              │ 선택: impl-2 ─ 타임라인 · 변경 · 로그                     ⌘↵ 열기       │
└──────────────┴──────────────────────────────────────────────────────────────────────┘
 role = 2px left bar in --role-*; status = dot in --ok/--warn/--bad/--idle; numbers .num
```

## 5. The canvas follows Eraser, not the app chrome

**Rule (user decision, 2026-11-13): the canvas and diagram blocks look the same as Eraser.** The Linear-like
tokens above are for app chrome only. Inside a diagram block, Eraser is the reference for node shapes, the colour
palette and `colorMode` (`pastel` / `bold` / `outline`), `styleMode` (`shadow` / `plain` / `watercolor`),
`typeface` (`rough` / `clean` / `mono`), connectors and `connectorStyle` (`elbow` default / `straight` / `arc`),
labels, group boxes, icon placement, font sizes and spacing. Sources: `docs/research/eraser/04-visual-design.md`
§7–§10 and `02-diagram-as-code-ai.md` (styling table, lines 39-47; `connectorStyle` rules, line 47). What stays
forbidden is unchanged (CLAUDE.md "Internal use only"): no Eraser name, logo, icon or illustration files, font
files or code (except the MIT `eraser-diagrams` code with its notice). Matching the look means re-drawing it with
our own renderer, Lucide/Simple Icons and OFL fonts. The work to close the gaps is its own ticket
(`dispatch-integration.md`, "Eraser 다이어그램 스타일 맞추기").

So no chrome token (the grey ramp, 6px radius, Inter 13px) leaks into `shared/render/`. The renderer
keeps its own theme table (`shared/render/theme.ts`), tuned against Eraser screenshots.

### Where the two looks meet (recommendation)

Three places touch both looks; the recommendation is **"the canvas owns everything inside its rectangle, the chrome
only frames it"**:

1. **Canvas background:** the canvas area uses the diagram theme's background (Eraser's near-white in light, its
   dark surface in dark), not `--background`. The chrome around it (`--panel`, 1px `--border`) frames it, so a
   small value difference between the two greys reads as a deliberate edge, not a mismatch. The dot grid stays
   low-contrast and is drawn by the canvas (`04-visual-design.md` §8).
2. **Selection colour:** selection inside the canvas (Excalidraw selection, layout-edit handles, the run overlay's
   focus) uses one canvas selection colour defined next to the diagram theme. It is owned by the canvas
   theme (Eraser rules) and does not borrow a chrome colour; the chrome has no accent hue.
3. **Dark/light switch:** one switch drives both (`data-theme`, OS by default, manual override kept). Diagrams do
   not get a filter: the renderer draws each palette for the theme from colour *names* (`color: green`), as
   Eraser does (dark mode is a viewer setting, not a file setting, `04-visual-design.md:59-60`). The current
   `invert(93%) hue-rotate(180deg)` trick (`web/src/index.css:214`) stays only for exported doc pictures and print
   until the renderer's dark palette covers every colour name; it is removed as part of the style ticket.

Also kept from before:

- **Excalidraw UI.** Re-skin its toolbar and menus through Excalidraw's CSS variables (`--island-bg-color`,
  `--default-border-color`, `--color-primary` …) in one block scoped under `.excalidraw`, mapped to chrome tokens:
  the toolbar is chrome, the scene is canvas. The `theme` prop stays (`canvas/ExcalidrawCanvas.tsx:665`).
- **Hand-drawn font** stays on the canvas only (`typeface rough` = Shantell Sans, already bundled); the UI never uses it.
- **Risk:** at 13px chrome, Excalidraw's built-in 14px+ islands look larger. Accept it in v1; scale its toolbar
  only if the screenshot pass shows a clash.
- **Run overlay** (pipeline progress on the diagram, part 2 §5.1) is drawn over the Eraser-look picture and uses
  Dispatch's status and role tokens, which exist in both themes; it never repaints the diagram itself.

## 6. Implementation base: options compared

| Option | Fit to Linear look | Effort | Keyboard / a11y | Risk | Verdict |
|---|---|---|---|---|---|
| **A. shadcn/ui + our tokens** | High: tokens drive everything; `cmdk` gives the menu | Medium: Dispatch already has 15 `ui/*` sources (`Dispatch/web/src/components/ui/`) | Radix: focus, roving, typeahead done | Low; code is vendored (MIT), we own it | **Recommended** |
| B. Keep hand-made CSS, only add tokens | Medium | Low now, high later (menus, dialogs, focus by hand) | We maintain it all; today's palette is a custom listbox (`CommandPalette.tsx:86-115`) | Drift between Drawing and Dispatch | Only as a stopgap |
| C. Radix Themes | Medium; its own look, harder to make dense | Low | Good | Second styling system next to Tailwind | No |
| D. Ark UI / React Aria + Tailwind | High (headless) | High: no ready sources | Very good | New stack for both apps | No, unless Radix blocks us |
| E. Mantine / MUI / Chakra | Low: heavy default look, runtime CSS | Medium | Good | Bundle size, fights Tailwind | No |

Decisions inside option A:

- **One Radix import style.** Dispatch uses the unified `radix-ui` package (`ui/dialog.tsx:4`); the WIP adds
  four `@radix-ui/react-*` packages (`748f6a4:package.json`). Pick `radix-ui` so sources copy across unchanged.
- **Icons: `lucide-react`** (ISC, already in both). Drawing already builds lucide icons for diagrams
  (`package.json` → `lucide-static`). No Linear icon look-alikes.
- **Fonts as files:** `@fontsource-variable/inter` (OFL) and `pretendard` (OFL), imported from CSS so Vite
  bundles them; no request leaves 127.0.0.1.
- **Dark variant:** keep `data-theme` (`theme.ts:19`) and map Tailwind `dark:` to it, as the WIP did
  (`@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`). Add `system` as a third choice
  like Dispatch (`store.ts:4`). Dispatch's separate "monitor" theme folds into dark: dark-first already is the
  dense, flat look; a TV view can stay as a layout, not a theme.

## 7. Things to avoid

- **No Linear assets or identity:** no logo or its shape, no product name in UI or code, no copied icons,
  illustrations, sounds, fonts files from their site, CSS or exact colour values. We aim at traits (section 2),
  not at a copy of any Linear screen. Same rule CLAUDE.md sets for Eraser.
- **No Eraser assets** either (CLAUDE.md "Internal use only"); no tldraw.
- **No network:** no Google Fonts, no CDN, no remote icon sets (CLAUDE.md, server rules). Excalidraw's font
  fallback is already pointed at our own copy (`web/vite.config.ts:20-21`); keep that check green.
- **No colour for decoration:** gradients, glows, coloured panels. Linear-like means colour carries meaning.
- **Not too small:** 13px is the floor for primary UI text, 12px only for meta. Korean below 12px is hard to read.
- **Contrast:** low-contrast greys still need 4.5:1 for body text and 3:1 for meta and borders that carry
  meaning (input outlines). `--text-4` is for disabled only.
- **Don't drop focus rings** for the look; keyboard first depends on them.
- **UI copy** stays Korean 해요체, short (CLAUDE.md "Rules").

## 8. the WIP (`748f6a4`, feat/shadcn-ui): reuse?

Verdict: **reuse parts, don't merge as-is.**

Keep:

- `web/src/lib/utils.ts` (`cn`), `ui/button.tsx` (already 32px/28px sizes and 6px radius), `ui/command.tsx`
  (cmdk), `ui/dialog.tsx`, `ui/dropdown-menu.tsx`, `ui/input.tsx`, `ui/kbd.tsx`, `ui/select.tsx`.
- `ui/segmented.tsx`: a good small idea (aria-pressed buttons styled as tabs) for the view switch.
- The `dark:` variant tied to `data-theme`, `--radius: 6px`, dark borders as white alpha (close to section 3.1), Inter
  via `@fontsource-variable/inter`, and the TopBar status dot.

Change before merging:

1. **Broken legacy variables.** The WIP deletes `--text`, `--elevated`, `--accent-soft`, `--danger` and `--dot`
   from `index.css` and keeps only `--surface` and `--text-muted` as aliases, but `App.tsx`, `BlockEditor.tsx`,
   `CommandPalette.tsx`, `DocPane.tsx`, `HistoryDialog.tsx`, `Sidebar.tsx` and `TrashDialog.tsx` still use them
   (`git grep 'var(--(text|elevated|accent-soft|danger|dot))' 748f6a4 -- web/src`). Example:
   `BlockEditor.tsx:15-22` (code editor colours) would lose its background and active line.
2. **`--accent` changes meaning.** Today it is the app's accent colour (`web/src/index.css:12`); in shadcn it is a neutral
   hover grey. `App.tsx:656` (same line in the WIP) paints a button with `var(--accent)`. Decision (2026-11-13): no accent
   hue; migrate such call sites to `--primary` / `--ring` / `--accent` (doc 6 §9 ⑤).
3. **Zinc palette → our tokens.** Replace the stock Zinc block with section 3, add `--panel`, text steps,
   status and role tokens from Dispatch.
4. **Radix imports:** switch the four `@radix-ui/react-*` deps to `radix-ui` (section 6).
5. **Not built or tested** (commit message). Needs `npm test`, `npm run build` and a headless look in both themes.

## 9. Rollout (small PRs, each with a headless screenshot)

1. Tokens + fonts + `dark:` variant, with legacy aliases (`--text`→`--foreground`, `--elevated`→`--panel`,
   `--accent-soft`→`--accent`, `--danger`→`--destructive`) so nothing breaks.
2. `ui/*` from the WIP on `radix-ui`; TopBar and Sidebar on them.
3. Command menu on `cmdk`, with a command registry other features (export, views, Dispatch) register into.
4. Dialogs (History, Trash, Export) and the Excalidraw skin block.
5. Dispatch screens moved in on the same tokens; remove the aliases once `grep var\(--` is clean.

## 10. Open questions

1. Default theme: follow the OS (as both apps now), or force dark for everyone with light as an option?
2. ~~Accent hue?~~ Decided 2026-11-13: neutral primary, focus and selection (shadcn stock), colour only for status.
3. Sidebar 220px and 28px rows: OK for Korean file names, or keep today's 240px/32px?
4. Dispatch's "monitor" theme: fold into dark (proposed) or keep as a fourth choice for wall screens?
5. Should the WIP owner continue `feat/shadcn-ui` with the changes in section 8, or start a fresh branch from step 1 of
   section 9 and cherry-pick the `ui/*` files?
