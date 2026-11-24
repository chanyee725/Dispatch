// @ts-nocheck -- vendored from eraser-diagrams (MIT); checked upstream under its own tsconfig, see README.md in shared/vendor/eraser-layout.
export function addToSet<T>(set: Set<T>, values?: Set<T> | readonly T[]): Set<T> {
  values?.forEach((value) => set.add(value));
  return set;
}
