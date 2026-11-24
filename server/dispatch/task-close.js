// Closes board tasks whose work already landed (#930). Leads often merge and forget `set_task done`, so open
// tasks sat in 확인 필요 as "지연" for days. The server checks open plan-to-merge tasks on a timer and moves one to
// done only with evidence, kept in `mergeCheck.evidence` (metadata only: commit, PR or issue number):
//   (a) the task's own work is on the integration branch: a branch it names made commits of its own and they are
//       on develop (branchStatus "merged"), or, for a task in review/test/merge, the commit hash it names is there.
//       A fresh branch with no commits, or a hash named during plan/impl, is an ancestor of develop too, so that
//       alone proves nothing;
//   (b) a merged PR is tied to the task's own issue (it closes it, or its branch names it) or its head branch is the
//       task's branch. PR numbers are never compared with issue numbers;
//   (c) the task's own issue is closed.
// The task's own issue is the one its branch names, else a `#N` that starts ("#879 세션 보드…") or ends ("… (#930)")
// its title. Other `#N` in a title ("(#879 회귀 수정)", "PR #907 …") only mention other work and are no evidence.
// Without evidence the task stays open and `autoCheck.reason` says why.
import { issueNumber, issueOfBranch } from "./ledger.js";

/** Stages the timer looks at; done and blocked are left alone. */
export const AUTO_CLOSE_STAGES = new Set(["plan", "impl", "review", "test", "merge"]);
/** Stages where a commit hash the task names counts as its finished work. */
const HASH_STAGES = new Set(["review", "test", "merge"]);

const TRAILING = /(?:^|[^\w&])\(?#(\d{1,7})\)?\s*$/;
// Leads also start a task title with its issue ("#879 세션 보드 대시보드 카드화"); a leading "PR #N" is a PR, not an issue.
const LEADING = /^\s*#(\d{1,7})(?=\s|$)/;
const SHA = /^[0-9a-f]{7,40}$/i;

/** The issue a task works on: the one its commit branch names, else a `#N` that starts or ends its title; or null. */
export function taskIssue(t) {
  const own = issueOfBranch(t?.commit);
  if (own) return own;
  const title = String(t?.title || "");
  const m = LEADING.exec(title) ?? TRAILING.exec(title);
  return m ? issueNumber(Number(m[1])) || null : null;
}

/**
 * Evidence that a task's work landed, checked a → b → c (cheapest first):
 * `{ ok: true, via: "commit"|"pr"|"issue", evidence, commit?, base? }` or `{ ok: false, reason }`.
 * - `verify(commit)`: verifyMerged's answer;
 * - `branchState(name)`: branchStatus' state ("merged" | "empty" | "open") or null when unknown;
 * - `prs`: issues.js parsePrs list (`{ pr: { number, state, branch? }, issues }`), or null when gh could not answer;
 * - `issueState(n)`: "open" | "closed" | null (unknown).
 */
export async function closeEvidence(t, { verify, branchState = async () => null, prs, issueState }) {
  const issue = taskIssue(t);
  const commit = typeof t.commit === "string" ? t.commit.trim() : "";
  const isBranch = commit && !SHA.test(commit);
  const why = [];
  if (commit) {
    let mayVerify = false;
    if (isBranch) {
      const state = await branchState(commit);
      if (state === "merged") mayVerify = true;
      else why.push(state === "empty" ? `${commit} 브랜치에 새 커밋이 없어요` : state === "open" ? `${commit} 브랜치가 아직 병합되지 않았어요` : `${commit} 브랜치 상태를 확인하지 못했어요`);
    } else if (HASH_STAGES.has(t.stage)) mayVerify = true;
    else why.push("계획·구현 단계라 커밋만으로 닫지 않았어요");
    if (mayVerify) {
      const check = await verify(commit);
      if (check?.ok) return { ok: true, via: "commit", commit: check.commit, base: check.base, evidence: `커밋 ${String(check.commit).slice(0, 7)}이 ${check.base}에 있어요` };
      why.push(check?.reason || "커밋 병합을 확인하지 못했어요");
    }
  }
  if (!issue && !isBranch) {
    if (!commit) return { ok: false, reason: "커밋과 이슈 번호가 없어 자동으로 닫지 못했어요" };
  } else if (Array.isArray(prs)) {
    const hit = prs.find(p => p.pr.state === "merged" && ((issue && p.issues?.has?.(issue)) || (isBranch && p.pr.branch === commit)));
    if (hit) return { ok: true, via: "pr", pr: hit.pr.number, evidence: `PR #${hit.pr.number}이 병합됐어요` };
  } else why.push("PR 정보를 읽지 못했어요");
  if (issue) {
    if ((await issueState(issue)) === "closed") return { ok: true, via: "issue", issue, evidence: `이슈 #${issue}이 닫혔어요` };
    why.push(`#${issue}에 병합된 PR이나 닫힌 이슈가 없어요`);
  }
  return { ok: false, reason: `병합 근거가 없어 열어 뒀어요: ${why.join(" · ")}`.slice(0, 200) };
}
