// Which workspace project a session belongs to, as its top-level folder path (server/workspace/projects.js),
// or null (미분류: files at the workspace root). Called `folder` because "project" already means the git project here.
// Metadata only.

/** The top-level folder of a workspace-relative file path, or null for a file at the root. */
export function topFolder(path) {
  if (typeof path !== "string") return null;
  const i = path.indexOf("/");
  return i > 0 ? path.slice(0, i) : null;
}

/**
 * The folder of a session saved before the field existed: the plan it is still linked to (plans[path].links,
 * reset per run, so best effort), else null.
 */
export function deriveFolder(s, plans) {
  const hit = Object.entries(plans || {}).find(([, e]) => e?.links && s?.id in e.links);
  return hit ? topFolder(hit[0]) : null;
}
