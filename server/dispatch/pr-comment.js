// The accounts summary as one PR comment (#747, #756): the lead (MCP post_accounts) or anyone with the API posts the
// `roles: …` line of an issue on its PR, and later calls update that same comment instead of adding new ones.
// Through `gh api` (cli.js), same per-workspace switch as PR tracking (pr-status.js). The comment holds only the
// marker, the issue number and accountsSummary's line (roles, models, account labels; never emails or account ids).
// Existing comments are matched by gh's --jq on GitHub's side: the server only ever sees comment ids, never bodies.
import { runCli } from "./cli.js";
import { classify, prTrackingEnabled } from "./pr-status.js";

export const ACCOUNTS_MARKER = "<!-- atelier:accounts -->";
const TIMEOUT_MS = 10000;

/** The comment body for an issue's summary line. */
export function accountsCommentBody(issue, summary) {
  return `${ACCOUNTS_MARKER}\n**#${issue}** ${summary}`;
}

/**
 * Makes `postAccounts({ pr, issue, summary })`, resolving to `{ ok: true, pr, comment: "created"|"updated", id }` or
 * `{ ok: false, reason }` ("disabled", "gh-missing", "not-logged-in", "timeout", "error"); never throws. When the PR
 * already has a comment with the marker, the newest one this gh login can edit is updated; else one is created.
 */
export function createAccountsComment({ workspaceDir, cwd, env, prDefault = async () => true, run = runCli, timeoutMs = TIMEOUT_MS } = {}) {
  const gh = args => run("gh", ["api", ...args], { cwd, env, timeout: timeoutMs, maxBuffer: 1 << 20 });
  return async function postAccounts({ pr, issue, summary }) {
    if (!Number.isInteger(pr) || pr <= 0 || !Number.isInteger(issue) || issue <= 0 || typeof summary !== "string") return { ok: false, reason: "error" };
    if (workspaceDir && !(await prTrackingEnabled(workspaceDir, await prDefault()))) return { ok: false, reason: "disabled" };
    if (typeof cwd !== "string" || !cwd) return { ok: false, reason: "error" };
    const body = accountsCommentBody(issue, summary);
    try {
      const { stdout } = await gh(["--paginate", `repos/{owner}/{repo}/issues/${pr}/comments`,
        "--jq", `.[] | select((.body // "") | startswith(${JSON.stringify(ACCOUNTS_MARKER)})) | .id`]);
      const ids = stdout.split("\n").map(Number).filter(n => Number.isInteger(n) && n > 0);
      for (const id of ids.reverse()) {
        try {
          await gh(["-X", "PATCH", `repos/{owner}/{repo}/issues/comments/${id}`, "-f", `body=${body}`, "--jq", ".id"]);
          return { ok: true, pr, comment: "updated", id };
        } catch (e) {
          if (classify(e) !== "error") throw e; // auth/timeout: give up; a comment by someone else: try the next
        }
      }
      const out = await gh(["-X", "POST", `repos/{owner}/{repo}/issues/${pr}/comments`, "-f", `body=${body}`, "--jq", ".id"]);
      const id = Number(out.stdout.trim());
      return { ok: true, pr, comment: "created", ...(Number.isInteger(id) && id > 0 && { id }) };
    } catch (e) {
      const reason = classify(e);
      return { ok: false, reason: reason === "no-pr" ? "error" : reason };
    }
  };
}
