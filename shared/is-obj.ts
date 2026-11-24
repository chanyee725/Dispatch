// A plain object: not null, not an array. One copy for the server and shared parsers.
// Generic so an `any` value (server JS) stays `any` while an `unknown` one narrows to a record.
export const isObj = <T>(v: T): v is T & Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
