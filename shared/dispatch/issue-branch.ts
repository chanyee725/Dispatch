// The GitHub issue a branch works on (#747, #756). Shared by the server (session ledger, issue list) and the web app
// (dashboard issue tiles), so both read a branch the same way.
//
// Only the `<type>/<n>-…` form names an issue: a conventional type, a slash, the issue number, then `-` or the end
// (`feat/747-accounts`, `fix/747`, `fix/issue-12`, `chore/gh-9-x`). A number anywhere else (`release/2026-11-19`,
// `feat/v2-ui`, `747-x`, `wip/12-x`) and Dispatch's own `dispatch/…` branches name none.

const TYPES = "feat|fix|docs|chore|refactor|test|perf|ci|build|style|revert|hotfix";
// Not followed by `-MM-DD`: `feat/2026-11-19-x` is a date, not issue 2026.
const BRANCH = new RegExp(`^(?:${TYPES})/(?:issue-|gh-)?(\\d{1,7})(?!-\\d{1,2}-\\d{1,2}(?:\\D|$))(?:-|$)`, "i");

/** The issue number a branch names, else null. */
export function issueOfBranch(branch: string | null | undefined): number | null {
  if (typeof branch !== "string") return null;
  const m = branch.match(BRANCH);
  const n = m ? Number(m[1]) : 0;
  return Number.isInteger(n) && n > 0 && n < 1e7 ? n : null;
}
