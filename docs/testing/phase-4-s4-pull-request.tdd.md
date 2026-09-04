# Phase 4, session 4 — the pull request

Written for `/ecc:tdd-workflow`. The plan it follows is the S4 row of
`docs/BUILD-PLAN.md` §M2 and DESIGN §6.0–§6.3; the three decisions it had to
settle first, plus the one thing that turned out to be missing, are ADR 0031.

Runner: `pnpm test`. Coverage: `pnpm coverage` and `pnpm coverage:check`.

## User journeys

1. As a maintainer, I want a run to open a draft pull request when it finishes,
   so CI runs before I spend attention on a diff that does not compile.
2. As a maintainer, I want one pull request per node, not one per attempt, so
   two rejections do not leave three open drafts.
3. As a reviewer, I want CI shown next to the scan, and I want a host that could
   not be reached to say so rather than read as green.
4. As a maintainer, I want to accept everything whose checks are all clean in
   one command, and to be told why the rest is not.
5. As anyone without a remote or without `gh`, I want the identical flow, minus
   the pull request and CI.

## RED, then GREEN

| Stage | Command | Result |
| --- | --- | --- |
| RED | `npx vitest run test/integration/pr.test.ts` | 13 failed: `publish`, `checksOf`, `pullRequestOf` did not exist |
| GREEN | same, after `packages/core/src/pr.ts` | 13 passed |
| RED | `npx vitest run test/integration/dispatch.test.ts` | 3 failed: `Dispatched` carried no `pr` |
| GREEN | same, after the dispatch wiring | 15 passed |
| RED | `npx vitest run test/integration/pr.test.ts` (green cases) | 5 failed: `greenNodes is not a function` |
| GREEN | same, after `greenNodes` | 18 passed |
| RED | `npx vitest run test/integration/dispatch.test.ts -t verif` | 2 failed: `verify` and `acceptance` were never filled in |
| GREEN | same, after judging the run in its worktree | 18 passed |
| Full | `pnpm test` | 330 passed, 38 files |

The git host is faked (`test/integration/fake-gh.mjs`) and nothing else is: a
real branch, a real push, a real bare remote. A test may not open a pull request
on somebody's account, so the host's own API is the one thing that stands in —
the same line ADR 0014 draws for the agent host.

## Six things the hand-driven demo found, and the code did not

1. **A pull request was opened over a branch with no commits.** Real `gh`
   refuses it, and there is nothing for CI to run. `publish` now skips, with the
   reason. — *a branch with nothing on it opens nothing*
2. **The CI line vanished when the host could not be reached.** It was gated on
   having read the pull request, and that read fails too — so "could not be
   read" rendered as nothing at all, which reads as clean. — *a git host that
   could not be read is said in the review, never dropped*
3. **`dispatch.verify` and the acceptance commands were never run.** The fields
   existed and nothing filled them, so no node could ever be green. — *a
   finished run is verified and its acceptance commands are run, in the
   worktree*
4. **A broken record read as a node nobody wrote.** `sober accept` said "is not
   on this board" for a file with one bad character. — *a record that will not
   parse is named*
5. **A node that never ran produced a raw git error** — "fatal: ambiguous
   argument" — where §8.7 requires a sentence. — *a node that has never run
   reviews as empty, not as a git error*
6. **A repository with no remote still showed a draft**, and spawned `gh` on
   every review to find out what the repository already knew. — *a repository
   with no remote has no pull request to look up*

## What the tests guarantee

| # | Guarantee | Where | Type |
| --- | --- | --- | --- |
| 1 | A finished run pushes its branch and opens one draft, and a second run updates it | `pr.test.ts`, `dispatch.test.ts` | integration |
| 2 | No remote, no `gh`, a refused push, or an empty branch all skip the step and say why — the run still finishes | `pr.test.ts`, `dispatch.test.ts` | integration |
| 3 | CI is read in every state it can be in, and an unreadable answer is `unavailable`, never `none` | `pr.test.ts` | integration |
| 4 | The review carries CI and the draft on both surfaces, and never drops the line | `pr.test.ts`, `mcp.test.ts` | integration |
| 5 | Accept lands locally by default and never calls the host; `pull-request` marks ready and merges, and refuses with no draft | `pr.test.ts` | integration |
| 6 | `--green` accepts what is green and names why the rest is not: verification, an acceptance command, the scan, or CI | `pr.test.ts` | integration |
| 7 | A finished run is verified in its worktree, a failed verification is recorded without failing the run, and a run that did not finish verifies nothing | `dispatch.test.ts` | integration |

## Coverage

`pnpm coverage:check` — core 97.19% (was 97.16), mcp 91.95% (was 91.71), cli 0%
(covered through the binary, which v8 cannot see — ADR 0014's known trade).

## Known gaps

- **`gh` itself is not proved.** The stand-in answers the way `gh` documents its
  exit codes and JSON, and a real repository is the only thing that proves the
  real one. Offered to the user as a separate, outward-facing run.
- Two defensive branches in `pr.ts` are uncovered: a `pr view` that answers with
  something that is not JSON, and a `pr ready` that fails on a pull request that
  was there a moment ago.
- `core` is at 106 exports against a ceiling of 100 (ADR 0029, 0030, 0031). The
  deletion pass named 22 candidates; the decision is the user's and still open.
