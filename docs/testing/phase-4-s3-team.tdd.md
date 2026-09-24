# Phase 4, session 3 — the team

Written for `/ecc:tdd-workflow`. The plan it follows is the S3 row of
`docs/BUILD-PLAN.md` §M2 and DESIGN §3.3, §3.4 and §8.5; the three decisions it
had to settle first are ADR 0030.

Runner: `pnpm test` (turbo build, then vitest). Coverage: `pnpm coverage` and
`pnpm coverage:check`.

## User journeys

1. As a maintainer, I want to say who is on this project, so a node can be
   handed to someone by name.
2. As a maintainer, I want to hand a node to a person ahead of time, so the
   plan is on the board rather than in a chat.
3. As a contributor, I want to say I am on a node now, so nobody else starts it
   by accident — and I want to be told, not stopped, if they do.
4. As a contributor, I want to know when the node I am taking predicts the same
   files as one someone else is on, so the merge is not a surprise.
5. As anyone, I want a board written by an older SOBER to keep working, and a
   board written by a newer one to be refused rather than quietly rewritten.

## RED, then GREEN

| Stage | Command | Result |
| --- | --- | --- |
| RED | `npx vitest run packages/schema/src/{contributors,node}.test.ts packages/core/src/{migrate,team}.test.ts` | 4 files failed, 5 tests failed: `migrate.js` and `team.js` did not exist, and `Node` rejected `assignee`/`claim` as unrecognized keys |
| GREEN | same command, after `schema`, `migrate.ts`, `team.ts`, `contributors.ts` | 13 passed |
| RED | `npx vitest run test/integration/team.test.ts` (before the surfaces) | the CLI had no `contributors`, `assign`, `claim` or `release` |
| GREEN | same command | 15 passed |
| Full | `pnpm test` | 295 passed, 37 files |

Two defects were found by driving `pnpm demo:team` by hand, not by reading code:

- migrated records were written with `assignee`/`claim` **first**, not in schema
  order — a whole-file diff to git and a phantom change to the field-level
  merge (§1.2.1). Fixed by writing migrated records back through the schema;
  covered by *a migrated record is written in schema order*.
- a claim hid the assignment, so "Bob is doing what was planned for Alice" was
  invisible. Fixed in `sober status`; covered by *someone else doing what was
  planned for a person is shown, not hidden*.

## What the tests guarantee

| # | Guarantee | Where | Type |
| --- | --- | --- | --- |
| 1 | A node carries an assignee and a claim, and a record written before they existed is not a node | `packages/schema/src/node.test.ts` | unit |
| 2 | The team record parses, rejects a handle-less contributor, and fails loudly on an unknown field | `packages/schema/src/contributors.test.ts` | unit |
| 3 | An older board is brought forward once, keeps every field, migrates the archive too, and is written in schema order | `packages/core/src/migrate.test.ts` | unit |
| 4 | A newer board is refused; an unreadable or absent one is not a board to migrate | `packages/core/src/migrate.test.ts` | unit |
| 5 | Overlap names only claimed, unfinished, other nodes whose globs meet | `packages/core/src/team.test.ts` | unit |
| 6 | Claim, release and assign refuse a node the board does not hold; assign refuses an unknown handle | `packages/core/src/team.test.ts` | integration |
| 7 | Contributors add twice to correct, remove reports whether anyone went, a broken team file is loud | `packages/core/src/team.test.ts` | integration |
| 8 | The CLI's five team commands do all of the above from a real repository, and `status` shows the plan behind the fact | `test/integration/team.test.ts` | integration |
| 9 | A board at schema 1 is brought forward on the way in and says so once; schema 99 is refused | `test/integration/team.test.ts` | integration |
| 10 | The session has the same four operations, and refuses an older board by naming the terminal | `test/integration/mcp.test.ts` | integration |
| 11 | Starting work claims the node with the same name every other surface attributes with | `test/integration/dispatch.test.ts` | integration |

## Coverage

`pnpm coverage:check` — core 97.16% (was 97.09), mcp 91.71% (was 91.02), cli 0%
(the CLI is covered through the binary, which v8 cannot see; that is ADR 0014's
known trade and why the in-process tests above exist).

## Known gaps

- The **dispatch-time** confirmation of §3.4 is not built. The claim-time
  warning is, and a run claims the node, so a run does say what it is heading
  for — but the confirmation that gates an unattended wave needs a decision
  about how a CLI that never prompts confirms anything (ADR 0030).
- `core` is at 102 exports against a ceiling of 100 (ADR 0029). The deletion
  pass found 22 names no consumer outside `core` uses; pruning them is its own
  change.
