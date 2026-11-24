// @ts-nocheck -- vendored from eraser-diagrams (MIT); checked upstream under its own tsconfig, see README.md in shared/vendor/eraser-layout.
/**
 * Layout state and connection routing (elbow, straight and arc lines, label placement). No DOM, no
 * browser: this module runs the same in Node and inside a browser bundle. Coordinates are
 * scene-space throughout.
 */

// layout state
export { LayoutManager } from './LayoutManager.ts';

// routing
export { COMMIT_REPAIR, isDirectConnection, routeConnections } from './routing/routeConnections.ts';
export type {
  ConnectionRoutingRequest,
  EndpointPins,
  RouteConnectionsArgs,
  RoutingResult,
} from './routing/routeConnections.ts';
export type { RepairPolicy } from './routing/executeCorridorRouting.ts';
export { anchorFromStored, resolveManualLabel } from './routing/manualLabelAnchor.ts';

// arc geometry
export {
  ARC_BEND_SNAP_THRESHOLD,
  defaultBendForChord,
  getArcApex,
  getArcPathD,
  getArcPolyline,
  isArcBend,
} from './arcGeometry.ts';

// geometry
export {
  addPaddingToRange,
  combineRanges,
  intersectRanges,
  makePropsFromRange,
  makeRangeFromEntity,
  shiftRange,
} from './rangeUtils.ts';
export { createEntityOutline, roundedCornerGeometry } from './outline.ts';
export type { CornerGeometry, EntityOutline } from './outline.ts';

export type {
  ConnectorStyle,
  Direction,
  LayoutConnection,
  LayoutConnectionChange,
  LayoutEntity,
  LayoutRange,
  NewConnection,
  OutlineDescriptor,
  OutlineVertex,
  Port,
  TextPlacement,
} from './types.ts';
export { LayoutConnectionTextPlacementSource } from './types.ts';
