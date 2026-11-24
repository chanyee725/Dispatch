Team rules (the project's CLAUDE.md / AGENTS.md wins where it differs):

- Talk to the user in Korean; write code, comments, identifiers and commit messages in English.
- Work in your own worktree and branch, off the integration branch (usually `develop`). Commit small, with conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- Lanes:
  - quickfix (1–3 files: UI position, copy, CSS, test updates): one session, no issue, no plan, no web-guidance lookup. Typecheck + one related test → push → PR by the PR role → one short review comment on the last commit. Past 3 files or on a failing check, move it to normal with an issue.
  - normal (one feature): lead + implementer + 1 fresh reviewer.
  - risky (auth, data, delete, structure): 2 reviewers.
- Review is a PR comment whose first line is `<last commit hash> — must-fix 없음` or `<last commit hash> — must-fix 있음`. A must-fix blocks the PR; should-fixes and nits go to the branch owner or a follow-up.
- PRs and merges have their own roles. Leads and implementers open no PR and merge nothing (no `gh pr create`, no `gh pr merge`). A Claude session outside those roles has both refused by its CLI; Codex and Gemini sessions keep the rule themselves.
  - PR role (`pr`): changes no code. Before opening, `gh pr list --state open --json number,headRefName,body`; when a PR for the same branch or the same `Closes #<n>` is open, it opens nothing and reports that PR number.
  - Merge role (`merge`, one per project): the only one who runs `gh pr merge --merge`. It merges only with a `must-fix 없음` review on the last commit, no other open PR for the same issue (two or more: stop and report), and for risky the main session's OK. Then `git merge --ff-only origin/develop` in the project folder and the task set to done.
- Every PR, quickfix included, is ready only with a `must-fix 없음` review on its last commit.
- Every brief has a done-when, small testable pieces, and asks for real command output in the report.
- Tests: the single test files that cover the change, plus typecheck. Run full `npm test` or e2e only when asked; one heavy run on the machine at a time.
- Run tests and builds in the foreground; browser checks run headless.
- Web work (normal and risky lanes) with the `modern-web-guidance` plugin installed: search → retrieve → check the code, end the PR with `### Modern Web Guidance`. Generic queries only.
- UI work follows the app's current design and `docs/design/ui-libraries.md` in the Atelier repo.
- Pushing feature branches is part of the job. Deploys, deleting data, CI or infra changes and other repos need the user's OK, relayed by the lead.
- Decide routine engineering yourself; ask the user (through the lead) only for product decisions. A lead settles review should-fixes, nits and whether a follow-up issue is needed on its own, and reports only the outcome; it asks the user only what the user alone can decide, such as product direction. Build only what was asked.
- Asking the user: Claude uses the AskUserQuestion tool (several questions in one `questions[]` call, 2–4 choices, the recommended one first with "(추천)"). Codex and Gemini, which lack the tool, ask in text: one question per turn, a line `질문 1/4: …?` with 2–4 numbered choices right below it (recommended first with "(추천)", each `라벨 — 이유 한 줄`), the question line ending in `?` and the question with its choices at the very end of the turn. The app's question card reads this text form too (`web/src/dispatch/lib/question.ts`): a click moves to the next question and the last one sends all answers.
- Privacy: keep `.env`, secrets, tokens, keys, emails and real names out of code, logs, docs and reports.
- Teammates: your final answer reaches the lead by itself; use `message_lead` mid-turn. End a turn with a result (branch, head, check output, what is left), committed (`WIP:` for unfinished work).
- Reports: short, action first, at most 5 items per list.
- Documents: when one part changes, fix every other place stating the same fact in the same turn, and search the whole document for the changed key words before saving.

Lead only:

- Plan and assign; edit no code and no documents yourself. Documents are written and changed only by a `docs` session. Pick the lane first. When the task names the cause, create the implementer at once.
- Split work so two sessions never edit the same files. Take ETAs from past runs of similar size.
- Every `set_task` that changes `stage` also sets `eta_minutes` (minutes left). Without it the server guesses from finished tasks' time in that stage and the dashboard marks it 예상.
- One task per implementer; start a fresh one for the next task. Finished teammates are removed automatically after their report.
- Batch messages; wait for reports instead of polling.
- When an implementer pushed, hand the branch and issue to the PR role. When the PR has a `must-fix 없음` review on its last commit, hand the PR number, issue, task id and lane to the merge role. Reuse a live merge role (list_sessions) instead of creating another.
- Models: you, the reviewer, and implementers of server, pipeline, data or risky logic run on Claude (Opus for code and review). Gemini Flash (through `agy`) takes the tester (test runs, headless screenshots, logs), the designer (screenshot review), and may implement UI, CSS, copy, test-only or mechanical multi-file changes. Pick the implementer per issue; on relay pass it with `DISPATCH_TEAM_ROLE_MODELS='{"impl":"gemini-3.8-flash-high"}'`. Claude Opus reviews every Gemini PR. Gemini runs in acceptEdits, auto or plan only.
- One team per issue. team.sh and relay.sh start no team when a live lead already holds the issue; they print that lead's name instead. Once the merge role reports the issue's PR merged, hand the rest of your queue to a fresh team as your very last step: `<plugin-root>/skills/atelier-team/scripts/relay.sh "<project-root>" "<your name>" <preset> "<the remaining issues only>"` (`<plugin-root>` holds `skills/atelier-team`; in the Atelier repo it is `plugin/`). It starts the new team, then removes your teammates and you; an empty task only removes. Put a handoff of at most 10 lines (owner, branch, head, next step) in the task when something is half done.
- Stale lead: idle, no running teammates, no open PR or unmerged branch it owns, and its issue merged or closed. A lead with no issue (a quickfix lead) is stale only when it also has nothing queued and its last report was 푸시 준비됨 or done.
- A lead or the main session may remove a stale lead. Check first: `GET <server>/api/state` shows the lead `idle` and no session whose `parent` is the lead in `starting`, `running` or `waiting`; `gh pr list --state open --json headRefName` lists none of its branches. Then `curl -X POST <server>/api/sessions/<id>/remove -H 'content-type: application/json' -H 'x-dispatch: 1' -d '{}'` (the call relay.sh uses; it kills without a busy check, and a worktree with uncommitted work is kept). If any check fails or you are unsure, report the lead instead of removing it.
