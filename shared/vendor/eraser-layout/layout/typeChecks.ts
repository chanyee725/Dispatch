// @ts-nocheck -- vendored from eraser-diagrams (MIT); checked upstream under its own tsconfig, see README.md in shared/vendor/eraser-layout.
import { type Axis, type LayoutConnectionChange } from './types.ts';

export function isAxis(arg: unknown): arg is Axis {
  return arg === 'x' || arg === 'y';
}

export function isShift(
  change: LayoutConnectionChange,
): change is { deltaX?: number; deltaY?: number } {
  return 'deltaX' in change || 'deltaY' in change;
}
