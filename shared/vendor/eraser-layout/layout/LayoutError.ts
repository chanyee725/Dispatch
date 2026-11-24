// @ts-nocheck -- vendored from eraser-diagrams (MIT); checked upstream under its own tsconfig, see README.md in shared/vendor/eraser-layout.
export class LayoutError extends Error {}

export class MissingEntityError extends LayoutError {
  constructor(msg: string, id: string) {
    super(`${msg}: ${id}`);
  }
}

export class LayoutDuplicateError extends LayoutError {
  constructor(msg: string, id: string) {
    super(`${msg}: ${id}`);
  }
}

export class RoutingError extends LayoutError {}
