# Phase 4, session 5 — the M2 gate, and the half of §3.4 nobody had built

- Source plan: none. The journeys come from `DESIGN.md` §3.4 and §5.3, `PRODUCT.md` `PR-05-06`, and D26 / ADR 0017 — all written long before this session and all unimplemented.
- Branch: `phase-4-team`
- Runner: `pnpm vitest run` (vitest 4), `pnpm coverage:check` for the ratchet

## Why this was in the gate's session

S5's deliverable is `pnpm gate:m2`. Writing the gate is what surfaced the two rows it could not walk: the same-files warning has no dispatch-time half, and "approve and queue" writes a flag nothing reads. A gate that steps around what it cannot check is a demo, so both were built first. ADR 0032 records the decisions; ADR 0033 records the export ceiling landing at 86.

## User journeys

1. As one person running two of my own nodes that touch the same files, I want to be told before either starts, so I find the collision now rather than at the merge.
2. As a teammate, I want a node someone else is already on to stop and ask me, and to start when I say so — never to refuse me outright.
3. As someone who approved a chain ahead of time, I want the next node to start when accepting the one before it makes it ready, so the planning time pays itself back.
4. As anyone, I want nothing started unattended that overlaps live work, that already ran, or that someone else has claimed.
5. As the person driving M2's gate, I want two clones of a **real** repository, a real `gh` and real CI, because a stand-in cannot tell me whether the product travels.

## RED, then GREEN

`test/integration/queue.test.ts` was written first, against `runQueue` and `OverlapError`, neither of which existed.

```
$ pnpm vitest run test/integration/queue.test.ts
TypeError: runQueue is not a function
 Test Files  1 failed (1)
      Tests  11 failed | 2 passed (13)
```

Two of the thirteen passed for the wrong reason — nothing refused anything yet, so a wave with an overlap in it ran clean. Both were tightened before implementation so they could only pass for the right one.

After `packages/core/src/{queue,team,dispatch}.ts` and the two surfaces:

```
$ pnpm vitest run test/integration/queue.test.ts
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

One existing test went red on the way and was right to: `dispatch.test.ts`'s wave fixture gave both its nodes `files: ['src/auth.ts']`, so the new check refused the pair. The fixture now gives the second node its own file — that test is about the halt, not about §3.4.

## What the passing tests guarantee

| # | What is guaranteed | Test | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | A node whose files meet an active node's is not dispatched, and the refusal names the node and who is on it | `queue.test.ts:a node heading for an active node’s files is not dispatched without a confirmation` | integration | PASS |
| 2 | Told to go anyway, it goes — the confirmation is not a block | `queue.test.ts:the confirmation is not a block` | integration | PASS |
| 3 | One person's own wave is checked against itself, and starts nothing it warned about | `queue.test.ts:one person’s own parallel wave warns about itself` | integration | PASS |
| 4 | A refusal stops only itself; the clean members of the wave still run | `queue.test.ts:a refused wave member does not stop the rest` | integration | PASS |
| 5 | Accepting an upstream node starts the queued node it just made ready | `queue.test.ts:accepting an upstream node starts the queued node` | integration | PASS |
| 6 | A node approved without `--queue` is never started unattended | `queue.test.ts:a node approved without the queue is never started unattended` | integration | PASS |
| 7 | Answering a decision drains the queue too | `queue.test.ts:answering a decision drains the queue too` | integration | PASS |
| 8 | A queued node meeting an active node's files is held, with the reason | `queue.test.ts:a queued node heading for an active node’s files waits for a human` | integration | PASS |
| 9 | Two queued nodes that meet each other hold each other | `queue.test.ts:two queued nodes heading for each other’s files` | integration | PASS |
| 10 | The chain stops at a rejection, and at a failure | `queue.test.ts:the chain stops at a rejection` · `…at a failure` | integration | PASS |
| 11 | A node someone else has claimed is theirs to start; your own claim does not stop it | `queue.test.ts:a node someone else has claimed is theirs to start` · `your own claim…` | integration | PASS |
| 12 | An empty queue costs nothing, and a queued node that cannot start is reported rather than thrown | `queue.test.ts:a queue with nothing in it` · `a queued node that cannot start is reported` | integration | PASS |
| 13 | The CLI refuses, names `--anyway`, cuts no branch, and runs on the second command | `cli.test.ts:a node heading for a claimed node’s files is refused` | integration | PASS |
| 14 | `sober accept` reports what the queue started | `cli.test.ts:accepting starts what was approved and queued behind it` | integration | PASS |
| 15 | The session asks the human, and starts when they say yes | `mcp.test.ts:a run that meets another node’s files asks the human` | integration | PASS |
| 16 | A run the human declines is not started and no branch is cut | `mcp.test.ts:a run the human declines is not started` | integration | PASS |
| 17 | A wave asks **once** for every node it warned on | `mcp.test.ts:a wave asks once about every node it warned on` | integration | PASS |
| 18 | The session's `accept` reports the queue too | `mcp.test.ts:accepting starts what was approved and queued behind it` | integration | PASS |
| 19 | Accepting a node whose branch is gone says so rather than reporting a git argument | `review.test.ts:accepting a node whose branch is gone says so` | integration | PASS |
| 20 | A repository whose board travels can be asked so, from a clone that has none of it | `board.test.ts:a clone can be asked whether this repository already carries a board` | integration | PASS |
| 21 | A clone with a `.sober/` and no board is refused, and told which command takes the team's | `cli.test.ts:a clone that has no board yet is told which command takes the team’s` | integration | PASS |
| 22 | A review of an accepted node says done, offers no second accept, and prints no diff line | `cli.test.ts:a review of a node already accepted says so` · `mcp.test.ts:accepting starts what was approved…` · `review.test.ts:a review of an accepted node carries the acceptance` | integration | PASS |

## Found by hand, not by the suite

Three, all from driving the built CLI against a scratch repository — the method that produced eight of S3 and S4's fixes and none of the suite's.

1. **The refusal contradicted itself.** The overlap warning ends with "Nothing is blocked", which is true at claim time and false two lines above "was not started". The footer is now the caller's.
2. **The queue started a teammate's claimed node.** `invoice-p2r4`, claimed by Bob, queued, ready — Alice's `accept` picked it up and would have cut the worktree and spent the money on her machine. Rule 4 in ADR 0032, with two tests.
3. **`accept` on a node whose branch is gone printed `fatal: ambiguous argument`.** Reachable through a merge that puts `accepted` back to null on a clone where accept already deleted the branch. It is a sentence now (§8.7), and the test says so by asserting the message does *not* contain `rev-list`.

## Found by the gate itself, on its first drive

M2's gate was driven on a real private repository — `sober init`, a session that
planned three nodes and answered two decisions, a run, a draft pull request with
Actions green on it, and an accept from inside the session. Three defects, all in
the terminal after work done in the session:

1. **A clone with a `.sober/` and no board rendered as an empty board.**
    `.gitignore` keeps `config.jsonc` tracked and the records off the base branch
    (§1.2), so the second person's clone has the directory and none of the graph.
    `findRoot` found it, every command opened it, and `sober status` printed a
    board with no nodes — §8.4's failure with the whole board missing rather than
    one record. Refused now, by the check `init` already makes.
2. **The refusal named the wrong command.** "run `sober init` at the root of your
    repository" is right for a repository with no board and wrong for a clone of
    one that has: it reads as *make a new board*, which is the single thing that
    puts two boards on one repository. A clone whose repository carries a board on
    its branch now gets its own sentence, and the gate's own step 11 said
    `sober sync` — the teammate ran it four times. Fixed in both places.
3. **A node accepted from a session still read as reviewable in the terminal.**
    `sober review` showed the run's exit rather than the node's status, offered
    `sober accept` on a done node, and reported "the diff is 1 lines" for an empty
    string. It says `done`, names who accepted it and when, and prints no diff
    line when there is no diff. Both surfaces.

The accept that followed the third refused with the sentence added earlier in this
session — "has no branch to merge" — which is the fix working and not a reason to
leave the review that offered it.

## Coverage

```
$ pnpm coverage:check
cli: 0% (baseline 0%)
core: 97.41% (baseline 97.4%)
mcp: 93.7% (baseline 93.7%)
```

`mcp` dropped to 88.38% when the tools were wired and before their tests existed; the ratchet refused it, which is the ratchet working. Three MCP tests brought it to 93.7%, above the 91.95% it started at, and the baseline moved with it. `cli`'s baseline is 0 by design — it is measured through a built binary in a subprocess, which v8 cannot see (ADR 0014).

## Known gaps

- **The gate has been driven as far as step 12 and no further.** Part 1's nine steps ran green on a real repository with real CI; part 2 stopped at the teammate joining. `docs/M2-GATE.md` is written when a full drive finishes — it records what a run found, and writing it from a partial one would be the thing this document exists to prevent.
- The overlap test is still `picomatch` either-way matching, unchanged from S3 and still carrying its `ponytail:` comment. `src/**` against `**/session.ts` is not caught, and no board has produced a miss worth the machinery.
