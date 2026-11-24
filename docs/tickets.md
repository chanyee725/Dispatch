# Atelier tickets

Goal: a local, internal-only technical diagramming tool that works and looks like Eraser.io: one file = a document and an infinite canvas side by side, diagram-as-code (Eraser-compatible syntax) auto-laid-out on the canvas, and free-form drawing on the same canvas.

The previous product in this repo (live draw.io viewer with Dispatch agent cursors, old T1–T7) is retired. Its code is removed in E0; git history keeps it.

Research is the spec: `docs/research/eraser/00-summary.md` first, then `01` (product, layout, flows), `02` (DSL grammar per diagram type, with examples), `03` (architecture, components, MVP), `04` (visual design), `05` (interactions and shortcuts), `08` (spike results and code in `research/spikes/`). Where a research file says (미확인), pick the simplest reasonable behaviour and note it in the PR.

Internal-only, never distributed: matching Eraser's layout, palette and feel is allowed. Do not copy Eraser's name, logo, icon/illustration/font files or code (except the MIT-licensed `eraser-diagrams` code, with its notice kept). Fonts from their original OFL sources. No tldraw (licence). No external network requests at runtime: everything bundled or vendored.

Order: E0 → (E1, E2 in parallel) → (E3, E4 in parallel) → E5 → E6 → E7 → E8. One branch off `develop` per ticket, one review, merged back into `develop`.

---

## E0. Clean slate

- Remove the old app: `server/watch`, `server/agents`, `server/history`, `web/src/{view,agents,history,data}`, their tests, the vendored diagrams.net viewer, old README sections, `research/spikes` stays.
- Keep the skeleton: Node ≥ 22 HTTP server bound to 127.0.0.1 with host check and static serving, SSE hub if useful, Vite + React + TypeScript + Tailwind building into `public/`, `npm test` / `npm run build`.
- `npm start -- <workspace-dir>` serves the app for that folder (default port 4330, `DRAW_PORT`).
- Done when: an empty Eraser-like shell (sidebar, top bar, empty canvas area) loads and `npm test` passes.

## E1. Workspace and file storage (server)

- A workspace is a folder. Each file is one JSON file (e.g. `*.dpx.json`) holding: title, document (rich text as JSON), canvas elements (free-form), and diagram blocks (`{ id, type, code, x, y, w, h }`). Folders map to sub-folders.
- API: list / create / rename / move / delete files and folders, read, write (whole-file save with a revision number; reject a stale write), and an SSE event when a file changes on disk from outside.
- Autosave from the web is debounced; writes are atomic (temp file + rename).
- Done when: tests cover CRUD, stale-write rejection, atomic write, external change event, and path traversal refusal.

## E2. Diagram-as-code parser (shared, pure TS)

- Eraser-compatible grammar for **cloud architecture / flowchart** first (they share nodes, groups, connections), per `02`: nodes with `[icon:, color:, label:, shape:]`, nested groups `{}`, connections `>`, `<`, `<>`, `-`, `--`, `-->` with labels, chained connections, `direction`, `title`, global styles, comments.
- Then **sequence** and **ERD** (separate small parsers sharing a tokenizer).
- Output: an AST + diagnostics with line/column; never throws on bad input; partial results for live preview.
- Done when: every example in `02` for these four types parses, and tests cover errors with positions.

## E3. Layout and render (shared)

- ELK.js layout for architecture/flowchart (groups as compound nodes, `direction`, orthogonal edges, edge labels); LCA coordinate fix from the `08` spike. Sequence and ERD get their own deterministic layout.
- Render to SVG matching Eraser's look (`04`): node shapes, group boxes, colours, icons (own or permissively licensed set; missing icon → neutral placeholder), labels, arrows. `styleMode`/`typeface: rough` can come later.
- Deterministic: same code → same SVG. Fast enough for live preview (< 150 ms for 100 nodes).
- Done when: snapshot tests for each type, and a headless screenshot of each type looks right.

## E4. Editor shell and diagram-as-code editor (web)

- Eraser-like layout (`01`, `04`): left sidebar (workspace files, folders, search), top bar (file title, view toggle 문서 / 둘 다 / 캔버스, export), split document | canvas with a draggable divider.
- Diagram block editor: CodeMirror 6 with syntax highlight for the DSL, live preview, error markers from E2, diagram type picker, templates from `02` examples.
- Light and dark themes. UI copy Korean 해요체.
- Done when: create a file, write an architecture diagram, see it render live, reload and it is still there.

## E5. Canvas (web)

- Excalidraw (MIT, self-hosted assets, no CDN) as the infinite canvas: shapes, arrows, text, freehand, frames, zoom/pan, selection, undo/redo.
- Diagram blocks live on the canvas as movable/resizable elements rendered from E3; double-click opens the code editor; edits re-render in place.
- Canvas state saves into the file (E1).
- Done when: free-form shapes and two diagram blocks coexist on one canvas, survive reload, and editing a block's code updates it on the canvas.

## E6. Document editor (web)

- Rich-text document pane (TipTap/ProseMirror, MIT): headings, lists, checklists, code blocks, tables, links, `/` command menu, markdown shortcuts.
- Embed a canvas diagram block in the document (live, read-only preview that jumps to the canvas).
- Done when: a document with headings, a code block and an embedded diagram saves and reloads.

## E7. Export and shortcuts

- Export a diagram block or the canvas selection to SVG and PNG; copy as image; export the document to Markdown.
- Keyboard shortcuts from `05` (P0 subset: tool keys, zoom, undo/redo, duplicate, delete, select all, command palette `Ctrl/Cmd+K`).
- Done when: exports open correctly and shortcuts are covered by a headless test.

## E8. Docs and launch

- `README.md` (Korean): what it is, install, `npm start -- <dir>`, screenshots, DSL cheat sheet, what is not supported.
- Done when: a fresh clone runs with `npm install && npm run build && npm start -- <dir>`.

---

Out of scope for now: multi-user realtime collaboration (Yjs later; keep the file model easy to move onto Yjs), AI generation, BPMN/swimlane, remote access, authentication.
