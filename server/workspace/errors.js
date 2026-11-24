// The error type of the workspace routes: an HTTP status and a path-free message.
export class StoreError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}
