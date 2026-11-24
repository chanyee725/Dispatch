// @ts-nocheck -- vendored from eraser-diagrams (MIT); checked upstream under its own tsconfig, see README.md in shared/vendor/eraser-layout.
import { RTree } from './rtree/RTree.ts';
import type { LayoutEntity, PositionProps } from './types.ts';

/**
 * Named compatibility surface for layout callers using the shared R-tree.
 */
export class LayoutTree<T extends PositionProps = LayoutEntity> extends RTree<T> {}
