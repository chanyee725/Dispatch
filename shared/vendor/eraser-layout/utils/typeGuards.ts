// @ts-nocheck -- vendored from eraser-diagrams (MIT); checked upstream under its own tsconfig, see README.md in shared/vendor/eraser-layout.
/** Narrows to a plain object bag: excludes `null` and arrays, so string keys can be read safely. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrows to a usable number: rejects `NaN` and both infinities. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
