# Vendored: `@eraserlabs/layout` and `@eraserlabs/utils`

Source: https://github.com/eraserlabs/eraser-diagrams at commit
`6bde2841f1fb3368716d18e038aefa2214aa295f` (2026-11-11), MIT, Copyright (c) 2026 Eraser Labs, Inc.
See `LICENSE`, `THIRD_PARTY_NOTICES.md` and `licenses/` (RBush MIT, Quickselect ISC, inside
`layout/rtree/RTree.ts`).

| Here | Upstream |
| --- | --- |
| `layout/**` | `packages/layout/src/**` (tests, `testUtils.ts`, `routing/routingTestUtils.ts` left out) |
| `utils/**` | `packages/utils/src/**` (tests left out) |

Drawing uses it only for elbow edge routing and edge-label placement (`shared/render/route-eraser.ts`, #733).
Node placement stays ours. No DOM, no network, no file access.

Local changes, so the code runs under Node type stripping and our `erasableSyntaxOnly` build:

- relative imports end in `.ts` instead of `.js`; `@eraserlabs/utils` points at `../../utils/index.ts`;
- `LayoutConnectionTextPlacementSource` is a const object plus type instead of an `enum`;
- two constructor parameter properties (`PriorityQueue`, `outline.ts` `EllipseOutline`) are plain fields;
- type-only names are imported with `type`;
- one comment link to a hosted workspace was removed (`routing/shiftRouting.ts`);
- every file starts with `// @ts-nocheck`: upstream checks it under its own looser `tsconfig`
  (`noUncheckedIndexedAccess: false`), which our `shared/tsconfig.json` does not allow.

Do not edit the logic here; take a newer upstream commit instead and redo the list above.
