---
name: atelier-quickfix
description: Land a 1–3 file change fast in Atelier's quickfix lane — one session, no issue, no reviewer, branch → check → PR → merge. Use for small UI moves, CSS, copy or test updates ("토스트 위치만 바꿔줘", "문구 고쳐줘", "빠른 수정"). Bigger or risky work goes to atelier-team.
---

# Atelier quickfix

One session does the whole change. No GitHub issue, no plan gate, no reviewer, no web-guidance lookup. The PR is the only record.

## Steps

1. Check the lane. List the files you will touch.
   Done when: the list has 1–3 files and none touches auth, data, delete or structure. Otherwise use `atelier-team`.
2. Branch off the integration branch (`develop`, else the default branch): `git switch -c fix/<short-name>`. An Atelier session uses its own worktree branch.
   Done when: `git status` shows the new branch and a clean tree.
3. Make the change in small commits (`fix(scope): summary`, English).
   Done when: `git diff --stat <base>...` shows only the listed files.
4. Run the typecheck and the one test closest to the change (one unit file or one e2e spec), not the full suite.
   Done when: both pass. Keep the real output for the PR.
5. Push and open a PR against the integration branch. The body lists what changed, the check commands and their result.
   Done when: `gh pr view --json url` prints the URL.
6. Merge. In a team the lead merges the quickfix (`gh pr merge --merge`). Without a lead, the session that opened the PR merges it once the checks pass.
   Done when: `gh pr view --json state` shows `MERGED`.

## When it grows

The change passes 3 files, or a check fails twice: stop, commit what you have, open a GitHub issue that names the branch and head, and move the work to the normal lane (`atelier-team`).
Done when: the issue exists and the lead or the user has it.
