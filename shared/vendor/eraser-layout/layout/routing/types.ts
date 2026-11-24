// @ts-nocheck -- vendored from eraser-diagrams (MIT); checked upstream under its own tsconfig, see README.md in shared/vendor/eraser-layout.
import type { LayoutConnection } from '../types.ts';

export type Point = [number, number];

/** Which end of a connection ('from' the source entity, or 'to' the target entity) */
export type EndpointSide = 'from' | 'to';

/** Position relative to an entity's box, as fractions of its width and height. */
export type RelativePortPosition = [number, number];

/** The fields a routing pass (shift, corridor or fallback) writes onto a connection. */
export type RoutedConnectionChange = Pick<
  LayoutConnection,
  'x' | 'y' | 'points' | 'relativeFromPort' | 'relativeToPort' | 'textPlacement'
>;
