# Dispatch integration 2: pipeline file format and live overlay

Status: proposal (read-only design, no code yet). Background: issue #87, Dispatch is merged into Drawing.
A pipeline is planned as a document + diagram in a `.dpx.json` file, then run, and its sessions are watched live on
that same diagram. This part covers the file format, step ↔ node links, the live overlay and run records.

## 1. Recommendation (short)

1. **Plan goes in the file, runs do not.** Add one top-level section `plan` to `.dpx.json` (format v4). Run state lives
   in sidecar files under `.drawing/runs/<file path>/<runId>.json`, next to the existing history folder.
2. **A step is linked to a diagram node by name.** `plan.block` names the diagram block; each step's `node` is the DSL
   node id (the same key the layout overrides use). The DSL itself is not extended, so Eraser-style code stays as is.
3. **The overlay is an HTML layer, not part of the picture.** Status, model, tokens/cost, branch and PR are drawn
   as badges over the block image, placed from the render `scene`, the way the layout edit overlay is placed today.
   The SVG, the canvas elements and the file are never touched by live updates.
4. **Live path:** session change in the merged Dispatch hub → run recorder (in memory) → SSE `run` event on the
   existing `/api/events` hub → web run store → overlay. The sidecar is flushed debounced (about 1 s), atomically.
5. **Conflicts:** the server never writes `.dpx.json` during a run, so human edits and live updates cannot collide.
   Agent edits to the plan use a section-level patch endpoint that re-reads under the store's lock.

## 2. Why the run must not live in `.dpx.json`

- Every save bumps `revision` and a stale save gets 409 (`server/workspace/store.js:552-555`). Cost/token updates
  arrive many times a minute; writing them into the file would 409 the person editing the document on every tick.
- An open file that changes on disk is reloaded or turned into a 409 choice (`web/src/externalChange.ts:15-20`),
  so server writes would also yank the editor around.
- Version history snapshots the file before saves (`store.js:140`, `store.js:172-186`); live writes would fill
  history with cost ticks and push real edits out of the `historyMax` window.
- Dispatch already keeps fast-changing state out of user files: debounced `state.json` (Dispatch
  `server/store.js:21-32`) and transcripts in `.dispatch/transcripts` (Dispatch `server/sessions.js:87-88`).

## 3. File format v4: the `plan` section

`normalizeContent` rebuilds the file from known fields and drops the rest (`server/workspace/model.js:82`,
`docs/workspace-api.md:25`), so `plan` needs `FORMAT_VERSION = 4` (`model.js:14`). An older server already treats a
newer version as read-only (`store.js:523`, `store.js:551`), which is the behaviour we want. A file without `plan`
is an ordinary drawing; v3 files stay readable and become v4 on the next save, like the v3 step (`workspace-api.md:30`).

```json
{
  "version": 4,
  "title": "Login with magic links",
  "document": { "type": "doc", "content": [] },
  "canvas": { "elements": [], "appState": {} },
  "blocks": [
    { "id": "b_pipe", "type": "flowchart", "x": 0, "y": 0, "w": 640, "h": 400,
      "code": "plan [label: \"Plan\"]\nimpl [label: \"Implement\"]\nreview [label: \"Review\"]\ntest [label: \"Test\"]\nmerge [label: \"Merge\"]\nplan > impl > review > merge\nimpl > test > merge" }
  ],
  "plan": {
    "v": 1,
    "block": "b_pipe",
    "defaults": { "provider": "claude", "perm": "acceptEdits" },
    "steps": [
      { "id": "plan",   "node": "plan",   "role": "lead",   "model": "claude-opus-5-5", "effort": "high" },
      { "id": "impl",   "node": "impl",   "role": "impl",   "n": 2, "task": "Implement section 2 of the document." },
      { "id": "review", "node": "review", "role": "review", "model": "gpt-5.6-luna", "perm": "plan" },
      { "id": "test",   "node": "test",   "role": "test" },
      { "id": "merge",  "node": "merge",  "role": "lead",   "gate": "manual" }
    ]
  }
}
```

Field rules (to be added to `docs/workspace-api.md`, checked by a shared `planProblem` / `cleanPlan` pair in
`shared/`, the same way `layoutProblem` / `cleanLayout` are shared today, `shared/render/block-layout.ts:36-40`):

| Field | Meaning |
|---|---|
| `plan.v` | Sub-format version (like `layout.v`, `block-layout.ts:7`). Unknown `v` = shown, not runnable. |
| `plan.block` | Id of the diagram block the steps are drawn in. Must exist in `blocks`. |
| `plan.defaults` | Fields copied into every step that omits them. |
| `steps[].id` | Unique, stable key used by runs. Defaults to `node`. |
| `steps[].node` | DSL node id in `plan.block` (`shared/dsl/types.ts:61` `GraphNode.id`). |
| `role`, `model`, `effort`, `perm`, `n`, `task` | Same meaning as Dispatch's create-session items (Dispatch `skills/dispatch/reference/api.md:54`). |
| `steps[].gate` | `auto` (default) or `manual`: the step waits for a person before it starts. |
| `steps[].after` | Optional explicit dependencies. Absent: taken from the diagram edges (below). |

Limits: at most 200 steps, `task` at most 20 000 characters, names at most 200 characters (same cap as layout names,
`block-layout.ts:39-40`). `task` is instructions, not transcript; no tokens, keys or personal data belong in it.

### Order comes from the diagram

Dependencies default to the edges between step nodes in `plan.block` (`shared/dsl/types.ts:84-91`, `from` → `to`;
chains are already expanded, `types.ts:102-103`). The person draws the pipeline once and the arrows are the order.
`after` exists only for cases the picture cannot say (a hidden dependency). Edges to non-step nodes are ignored;
a cycle makes the plan not runnable, with the cycle named in the plan panel.

### Step ↔ node link

- The link key is the node id, the same key `block.layout.items` uses (`block-layout.ts:9-18`), so a renamed node
  breaks both in the same way. The web reconciles on code edit: if exactly one step lost its node and exactly one new
  node appeared, offer "이 단계를 새 노드에 연결할까요?" instead of silently relinking.
- A step whose node is missing still runs (the plan is the source of truth for running); its badge goes to a
  "다이어그램에 없는 단계" list in the plan panel.
- Not chosen: node attributes in DSL (`impl [step: impl]`). That would diverge from Eraser-compatible code and put
  run config into code the person types.

## 4. Run records: `.drawing/runs/`

Path: `.drawing/runs/<file path>/<runId>.json`, mirroring `.drawing/history/<file path>/` (`store.js:22-23`,
`store.js:140`). Hidden names are never listed (`store.js:440`, `store.js:459`) and cannot be addressed by the
file API (`server/workspace/paths.js:20`), so runs never show up in the tree or collide with user files. `runId` is
`<ms timestamp>-<hex>` like trash entries (`store.js:267`).

```json
{
  "v": 1,
  "id": "1763000000000-a1b2c3",
  "file": "pipelines/magic-links.dpx.json",
  "plan": { "revision": 12, "hash": "sha256:…", "snapshot": { "v": 1, "block": "b_pipe", "steps": [] } },
  "startedAt": 1763000000000,
  "endedAt": null,
  "state": "running",
  "steps": {
    "impl": {
      "state": "working",
      "startedAt": 1763000060000,
      "endedAt": null,
      "sessions": [
        {
          "sid": "s_14", "name": "Juno", "provider": "claude", "model": "claude-sonnet-5-5", "effort": "high",
          "state": "working", "stateSince": 1763000300000,
          "tokens": { "input": 120000, "output": 9000, "cacheRead": 800000, "cacheWrite": 40000 },
          "cost": 1.84, "ctxPct": 41,
          "branch": "dispatch/impl-14", "commit": "c06f887",
          "pr": { "number": 88, "state": "open" },
          "attention": null
        }
      ]
    }
  },
  "totals": { "cost": 3.41, "mtok": 2.1 },
  "timeline": [[1763000060000, "impl", "working"], [1763000900000, "review", "working"]]
}
```

- `state` per session uses Dispatch's derived states (`working` · `waiting` · `stuck` · `failed` · `resting` ·
  `done`, Dispatch `api.md:24`). Step state is the worst of its sessions (`failed` > `stuck` > `waiting` > `working`
  > `resting` > `done`); `pending` / `skipped` / `blocked` before or without sessions.
- `tokens`, `cost`, `ctxPct`, `branch` come straight from the session object (Dispatch `api.md:20`,
  `server/sessions.js:463`, `:936`, `:990`). `name` is Dispatch's random short name (`api.md:38`), not a person.
- `pr` is new: Dispatch tracks only a task `commit` (`api.md:76`), not PRs. Filled from `gh pr view <branch>
  --json number,state` when a step reaches `merge`, and on demand. Number and state only; no title, body or author.
- **Never stored:** transcripts, prompts sent to sessions, a session's `last` answer, questions, tool output, emails,
  tokens/keys. The run links to transcripts by `sid`; Dispatch keeps those separately and deletes them with the session.
- `plan.snapshot` copies the plan as started, so a run stays readable after the plan is edited or the file is deleted.
- `timeline` is `[at, step, state]` only, capped at 500 entries (Dispatch caps per-session timelines at 200, `api.md:74`).

### Size and retention

- One file per run. Expected size: 2–20 KB (5–20 steps, a few sessions each, capped timeline). A hard cap of
  256 KB per run file: past it, the oldest timeline entries go first.
- Keep the newest 50 runs per pipeline file and runs younger than 90 days, pruned on run start the same way
  history prunes (`store.js:186`). A running run is never pruned.
- Move / rename / delete / restore follow the history rules: runs move with the file (`store.js:239-247`), go into
  the trash entry on delete (`store.js:276-290`) and come back on restore (`store.js:409`).
- In the file itself only `plan` grows, so `.dpx.json` size stays proportional to what a person wrote.

## 5. Live overlay (renderer and canvas)

### Where it is drawn

A diagram block is an Excalidraw image of the rendered SVG (`web/src/canvas/render.ts:65-69`,
`web/src/canvas/sync.ts:233`). Two ways to show status:

| | Bake into the SVG | HTML overlay (recommended) |
|---|---|---|
| Per tick | New SVG → new `fileId` → new image, picture cache churn (`render.ts:19`, `:66`) | Only React state changes |
| Saved file | Canvas image changes can trigger saves (revision bumps) | Nothing saved |
| Export | Status leaks into exports | Exports stay clean; a "실행 상태 포함" option can bake a finished run later |
| Precedent | — | `LayoutEditOverlay` already floats over a block image (`web/src/canvas/LayoutEditOverlay.tsx:28-43`) |

So: a new `web/src/canvas/RunOverlay.tsx`, mounted next to `LayoutEditOverlay` (`ExcalidrawCanvas.tsx:680`).

### How badges find their node

1. The render result already carries the laid-out `scene` with a box per node, keyed by node id
   (`shared/render/scene.ts:40-53`, `SceneBox.id`; also `data-id` in the SVG, `shared/render/svg.ts:105`).
2. Add a pure helper in `shared/render/` — `nodeRects(scene): Map<string, {x, y, w, h}>` — unit-tested in Node.
3. Map scene → screen with the same frame math as layout edit: `layoutFrame(...)` with scroll, zoom and the
   picture's origin (`ExcalidrawCanvas.tsx:136-143`, `web/src/canvas/layoutEdit.ts:17`, `:38`). Re-run on
   scroll/zoom only; run updates do not move anything.
4. While the block's code has errors and shows its last good picture (`render.ts:9-10`, `lastGood`), badges keep
   the last good scene's rects too, so they stay on the right boxes.

### What is shown

- **Node ring:** state, colour and effect rules are in §5.1 (five display states, agent role colours, reduced
  motion). An earlier draft used fixed colours per Dispatch state; §5.1 replaces it.
- **Badge under the node** (one line, shrinks with zoom, hidden below 40 % zoom): model short name · `$1.84` ·
  `2.1M` tokens · branch chip · `#88` PR chip. `n > 1` shows a count with a hover list per session.
- **Active edges:** optional later; needs connector ids in the scene, which it does not have yet.
- **Click:** opens the session sheet (transcript read live from the Dispatch side, never from the run file).
- **Run picker** in the file header: "실행 중" / past runs. Past runs render the same overlay from the sidecar.

### 5.1 The diagram as the progress board (later stage, user direction 2026-11-13)

Today runs are planned with tickets and the overlay shows badges. The direction is that **the drawn diagram itself
becomes the progress board**: which nodes are done, in progress or not started, how far the whole run is, and
which agent owns what, all readable on the diagram without opening another view.

**Link key.** A step is tied to a node by the DSL node id (`steps[].node`, default `steps[].id`), the same key the
layout overrides use (§3 "Step ↔ node link"). An edge between two step nodes is keyed by its `from`/`to` node ids,
not by the renderer's `e1, e2…` order ids, so it survives code edits that reorder lines.

**Step state (display).** Five values, derived on the server from the run record and the task board, sent in the
`run` SSE patch as `step.view`:

| Key | Label | Derived from | Glyph |
|---|---|---|---|
| `pending` | 대기 | no session yet, or board stage `plan` | ◌ hollow circle |
| `active` | 진행 | stage `impl` / `test` / `merge` and no session `failed`/`stuck` | ● filled circle |
| `review` | 리뷰 | stage `review` | ◐ half circle |
| `done` | 완료 | stage `done` (merge check ok, or closed without a commit) | ✓ check |
| `blocked` | 막힘 | stage `blocked`, a session `failed` or `stuck`, or the step paused by the limit guard | ⚠ triangle |

A session waiting on a person keeps the step `active`/`review` and adds a small "사람 기다림" tag; it is not a
progress state. The run record still keeps the raw per-session states (§4); `view` is computed, never stored.

**Colour rules.**

- Each agent's colour is its **Dispatch role colour** (`--role-*`, lead/impl/review/test/design/docs), defined for
  both themes. Two sessions of the same role get the same hue at different lightness steps (up to 3) plus their
  short name in the badge, so colour never has to carry identity alone.
- `active` and `review` use the owning agent's colour; with no owner yet, `--ok` green. `done` uses `--ok` green,
  `blocked` uses `--bad`, `pending` uses `--idle` grey. Status colours come from Dispatch's tokens, the same ones
  the sessions board uses.
- A **legend** (collapsible) sits beside the picture on the canvas, on the side with room (under it, else left,
  else right, else above), clamped inside the canvas pane and letting clicks through except on its fold toggle;
  in the document it sits under the picture. It never covers a node, and it shows only when the board does (at
  least one step links to a node). One row per agent (role colour swatch, short name, role, model) and one row per
  state glyph. Only agents and states present in the run are listed.

**Effects.**

- Node: `active`/`review` get a 2px ring in the agent colour with a slow pulse (opacity 0.5 ↔ 1, 1.6 s);
  `done` a solid thin ring and a ✓ corner badge; `blocked` a solid red ring and ⚠, no animation (a stopped thing
  should look stopped); `pending` a dashed grey ring.
- Edge: an edge whose target step is `active`/`review` and whose source is `done` gets a flowing dash along its
  path in the target agent's colour; an edge between two `done` steps is solid green; others stay as drawn. This
  needs connector paths with `from`/`to` in the render scene (today the scene has node boxes only, see "Active
  edges" above); adding `SceneEdge { from, to, points }` to `shared/render/scene.ts` is part of the ticket.

**How it is drawn.** One transparent SVG layer laid over the block picture, positioned with the scene → screen
frame math (§5 "How badges find their node"), never baked into the block SVG. The same component draws in both
places: `RunOverlay` on the canvas and inside the document's diagram embed (`web/src/doc/DiagramView.tsx`), which
already draws the block picture from the same render result. Exports leave it out unless a later "실행 상태 포함"
option asks for it (open question).

**Progress.** Shown as a bar plus text at the top of the legend and in the run strip: `5단계 중 2 완료 · 48% ·
남은 3 (막힘 1)`. Weighted per step: `pending` 0, `active` 0.5, `review` 0.8, `done` 1. `blocked` keeps the weight
of the state it was in before blocking (so blocking never makes the bar go backwards) and is counted separately in
the text. Steps closed as abandoned (그만둠) leave the denominator. Percent = sum of weights ÷ counted steps,
rounded down so 100% means every counted step is `done`. Steps with `n > 1` sessions count once.
A blocked step whose history fell off the capped timeline counts as `active` if it had started. A run whose every
step was skipped shows `건너뛴 단계뿐이에요` and no bar.

**Accessibility.**

- Never colour alone: every state has a glyph and a text label (badge text and `aria-label`, e.g.
  "로그인 화면 · 진행 · Juno(구현자)"); the legend repeats glyph + label.
- `prefers-reduced-motion: reduce`: no pulse and no flowing dash. `active`/`review` become a static thicker ring
  (3px) and edges a static dashed line in the same colour.
- Contrast: rings and glyphs keep 3:1 against both diagram backgrounds; checked in the headless screenshot pass in
  light and dark.

**Fit with "canvas looks like Eraser".** The board is a layer *over* the Eraser-look picture: it adds rings,
badges and a legend but never changes node fills, shapes, connector style or fonts, so the diagram underneath
still reads as the Eraser-style drawing the person wrote.

### Live update path

```
Dispatch hub (session object changes, burn tick every minute — Dispatch api.md:28)
  └─ run recorder (server, in memory; one per running run)
       ├─ SSE  event: run   data: { file, runId, step, session: {sid, state, cost, tokens, ctxPct, branch, pr} }
       │        on the shared hub (server/events.js:21-24, GET /api/events at server/app.js:24)
       └─ debounced atomic write of .drawing/runs/... (≈1 s; store.js:83-94 pattern)
web: useRun(openPath) — fetch GET /api/runs?path=…&id=… once, then apply `run` events → RunOverlay
```

- Patches carry only changed session fields; the recorder coalesces per session to at most 2 events/s.
- On SSE reconnect the web refetches the run (events have no sequence numbers today, `events.js:21-24`).
- The `workspace` SSE event and `externalAction` (`externalChange.ts`) are not involved: sidecar writes are not user
  files, and the watcher skips hidden names (`store.js:728`).

New API (read only for the web; writes stay server-internal):

| Route | Returns |
|---|---|
| `GET /api/runs?path=` | `{ runs: [{ id, startedAt, endedAt, state, totals }] }`, newest first |
| `GET /api/runs/run?path=&id=` | the run record above |
| `GET /api/runs/active` | `{ files: string[] }`: files with a run going now (project home "실행 중") |
| `POST /api/runs?path=` | start a run from the file's current plan (run control itself is part 3) |

## 6. Conflicts: people vs the server

| Who writes | What | How |
|---|---|---|
| Person in the editor | whole file incl. `plan` | existing `PUT /api/file` with `revision` (`store.js:539-561`) |
| Run recorder | sidecar only | never touches `.dpx.json` |
| Agent (lead) changing the plan mid-run | `plan` only | new `PATCH /api/file/plan` |

`PATCH /api/file/plan` `{ revision?, ops }`: inside the store's `serial()` lock (`store.js:47`) it re-reads the
file, applies step-level ops (`add`, `set`, `remove` by step id), validates, writes with `revision + 1`, then
broadcasts a `workspace` `change` with the new revision. Today API saves are silent (`workspace-api.md:24`); this
one must not be, so an open, clean tab reloads (`externalChange.ts:19`) and a dirty tab gets the existing 409
choice on its next save. A person's unsaved diagram edits are never overwritten by the server.

A plan edited during a run does not change the running run: the run keeps `plan.snapshot` and the overlay
matches by node id against the current diagram. Steps added to the plan join the run only when a person (or the
lead through the API) says so.

## 7. Work split (for tickets)

1. `shared/`: `planProblem` / `cleanPlan`, `planOrder(plan, diagram)` (edges → order, cycle check), `nodeRects(scene)`.
2. Server: `FORMAT_VERSION = 4` with `plan` in `normalizeContent`; `PATCH /api/file/plan`; `docs/workspace-api.md`.
3. Server: run recorder, `.drawing/runs` store (prune, move/trash/restore with the file), `run` SSE, `GET /api/runs*`.
4. Web: plan panel (steps for the selected block, lost links), `useRun`, `RunOverlay`, run picker.
5. Tests: v3 → v4 round trip; older-version read-only; plan patch vs dirty tab (409); overlay placement e2e in a
   headless browser against a scratch workspace with a fake run recorder (no real sessions).

## 8. Open questions

1. Order from edges by default, or always an explicit `after`? (Recommended: edges; `after` as override.)
2. One plan per file, or allow several (`plan.block` per plan)? v1 assumes one.
3. Where do Dispatch's own state and transcripts live after the merge: `.dispatch/` in the workspace or
   `.drawing/dispatch/`? This decides whether `sid` links survive moving the workspace.
4. PR tracking: polling `gh` makes outbound requests, against the "no outbound network" rule in `CLAUDE.md`.
   Allowed only for the run feature, opt-in per workspace, or left out (branch + merge check only)?
5. Should a finished run be bakeable into an export (PNG/SVG with status), or never?
6. Retention numbers (50 runs / 90 days / 256 KB): fine as defaults, or a workspace setting?
