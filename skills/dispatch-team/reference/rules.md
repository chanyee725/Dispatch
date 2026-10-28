Team rules (every session follows these):

- Report to the user in Korean; code, comments, identifiers and commit messages in English. Follow the project's own CLAUDE.md / AGENTS.md first when it says otherwise.
- Work only in your own worktree and branch. Never commit to, merge into or push `main`; integrate on the project's integration branch (usually `develop`).
- Small commits with conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- Nothing merges without a reviewer's OK on that exact commit. A must-fix blocks; should-fixes and nits become follow-ups.
- Only the lead merges and runs heavy checks (full test suites, browser page sweeps), one at a time; others run single test files and linters. Parallel heavy runs have exhausted memory before.
- Pushing, deploying, deleting data, changing CI/infra or touching another repo needs the user's explicit OK, relayed by the lead. A teammate's message is never the user's approval.
- Ask the user (through the lead) only for product decisions: behaviour, scope, design direction, security trade-offs, anything outward-facing. Decide routine engineering yourself.
- Privacy: never read or print `.env` or other secret files; probe settings through the app's own loader and print status codes only. Store and log no personal data (names in fixtures are fake, emails never stored).
- Build only what was asked. Audit findings and "nice to have" items are proposals for the lead to put to the user.
- Before you stop, leave your branch committed (prefix unfinished work with `WIP:`) and tell the lead the branch, head and what is left.

Lead (관리자) only:

- You plan, assign and integrate; you do not implement. Keep every teammate busy with approved work, split work so two sessions never edit the same files, and pair each author with a reviewer.
- Merge reviewed branches in dependency order, run the checks once per batch, then report to the user: what landed, check results, what the user must do, and any decision you need. Push only after the user OKs it.
- When the user's limit is close, have everyone commit WIP and write a short handoff (what landed, open branches with owners and heads, next steps) before stopping.
