# S8 — the impact preview, and the end of M3's code

- Date: 2026-09-07
- Branch: `phase-5-dashboard`
- Plan: `docs/BUILD-PLAN.md` §M3's last item; the spec is DESIGN §2.8, the
  decision behind it is PRODUCT D19, and the deferral it closes is ADR 0015
- Decisions settled first: **ADR 0044**
- Runner: `pnpm test` (turbo build, then vitest). Coverage: `pnpm coverage` then
  `pnpm coverage:check`.

## What the forks were, and what they were answered with

Four were put to the human before any code (ADR 0044 records the reasoning):

1. **Read, not a stored dry run.** `GET /read/impact?decision=…`, shaped like
   `review` and `digest`.
2. **The first row clears the brief**, landing the node on `needs-brief` — the
   status §2.8 names, and the price is that an agent has to write the approach
   again.
3. **One operation with a flag**, not two. `edit_decision` + `anyway`, which is
   ADR 0032's vocabulary rather than a second one.
4. **ADR now, M3's gate next session.** The gate is nine steps driven by hand.

Two questions were answered from the code instead of being asked:

- **Rows two and three write nothing.** `flagsOf`'s `stale` compares
  `answer.at` against `max(approval.at, dismissal.at)` and never reads status,
  so a running, in-review or finished node is flagged by derivation. Proven by
  test, not assumed.
- **"Re-rendered" was already free.** `renderBrief` is a read-time render; only
  the approach and the acceptance list are stored.

## User journeys

1. As someone who changed their mind, I want to change an answer I already
   gave, so a decision I got wrong is not permanent.
2. As that person, I want to see everything the change reaches **before** it
   happens, so an irreversible fan-out is never triggered unseen.
3. As that person, I want to see which nodes are *running* against the answer,
   so I can stop one myself — nothing stops automatically.
4. As someone on the command line, I want the same ability in a surface with no
   dialog, spelled the way `run --anyway` already spells a confirmation.
5. As someone in a host session, I want **one** question for the whole fan-out,
   not one per node.
6. As a reviewer of a node that was built against a changed answer, I want the
   board to know — which is the flag §2.8 widened.

## RED, then GREEN

| Stage | Command | Result |
| --- | --- | --- |
| RED | `pnpm vitest run --project '@besober/schema'` | 4 failed — the `edit_decision` tripwire flipped on purpose, and `Impact` did not exist |
| GREEN | same, then `-u` for the two ratchet snapshots | 62 passed, 2 snapshots deliberately updated |
| RED | `pnpm vitest run --project '@besober/core' impact` | suite failed to load: `./impact.js` did not exist |
| GREEN | same, after `impact.ts` | 16 passed |
| RED | `pnpm vitest run data.test` (dashboard) | 2 failed — `offer` still refused an answered decision |
| GREEN | same, after `offer` was reshaped | 30 passed |
| RED | `pnpm vitest run Decision.test` (new DOM test) | 4 failed — the screen had no preview, no confirmation and no `chosen` marking |
| GREEN | same, after `Decision.tsx` | 15 passed |
| RED (consequential) | `pnpm test` | 5 failed: four assertions that described the refusal this step lifts, plus one that used `/read/impact` as an example of a route nobody serves |
| GREEN | `pnpm test` | **645 passed (62 files)**, up from 612 |

The five consequential failures were each updated deliberately, not silenced:
the server's "no speculative fifth read" became "no speculative sixth", the
unrouted-read example moved to `/read/everything`, the session's tool count and
list gained `edit_decision`, and the CLI's refusal text now names the command
rather than the milestone.

## What the tests guarantee

| # | What is guaranteed | Where | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | A node that has not started is the only row the save writes to | `packages/core/src/impact.test.ts` | unit | PASS |
| 2 | Running, in-review and finished nodes are flagged with no write at all | `packages/core/src/impact.test.ts` | unit | PASS |
| 3 | A node whose brief was never approved is not in the preview | `packages/core/src/impact.test.ts` | unit | PASS |
| 4 | An edit with no confirmation refuses, carries the fan-out, and writes nothing | `packages/core/src/impact.test.ts` | unit | PASS |
| 5 | The confirmed save clears the brief and lands the node on `needs-brief` | `packages/core/src/impact.test.ts` | unit | PASS |
| 6 | An unanswered decision and an unoffered option are refused before any fan-out | `packages/core/src/impact.test.ts` | unit | PASS |
| 7 | The preview is a shape three surfaces can parse, with two effects and no third | `packages/schema/src/wire.test.ts` | unit | PASS |
| 8 | The catalogue carries one entry for the edit and none for a preview operation | `packages/schema/src/operation.test.ts` | unit | PASS |
| 9 | An answered decision offers its options again, with the standing answer marked | `apps/dashboard/src/panel/data.test.ts` | unit | PASS |
| 10 | The screen cannot save a changed answer before the fan-out has been asked for | `apps/dashboard/src/panel/Decision.test.tsx` | DOM | PASS |
| 11 | The rendered fan-out names each node and the status a running one is in | `apps/dashboard/src/panel/Decision.test.tsx` | DOM | PASS |
| 12 | The read is served, a missing decision is a 409, and the flag separates seeing from saving | `test/integration/wire.test.ts` | integration | PASS |
| 13 | On the command line the first call prints the fan-out and the second applies it | `test/integration/cli.test.ts` | integration | PASS |
| 14 | In a host session it is one elicitation naming every node it reaches | `test/integration/mcp.test.ts` | integration | PASS |
| 15 | A human who does not confirm changes nothing | `test/integration/mcp.test.ts` | integration | PASS |
| 16 | A typo refuses before the question is asked, so it never costs a person one | `test/integration/mcp.test.ts` | integration | PASS |
| 17 | All three surfaces answer `edit_decision` | `test/integration/contract.test.ts` | integration | PASS |

## Coverage

`pnpm coverage:check`, after the run:

```
cli: 0.13% (baseline 0.14%)      core: 97.49% (97.48)
dashboard: 41.33% (41.33)        mcp: 94.08% (93.98)
server: 94.33% (94.16)
```

Only `dashboard` moved in the baseline, and only because a rise over one point
must be committed. `--update` was **not** run: it would have written `cli` down
from 0.14 to 0.13, lowering a ratchet to accommodate 74 lines of terminal
rendering that unit coverage cannot see. `mcp` and `server` first came back
*down* — the new tool and the new route had no tests — and were brought back up
by writing the three integration tests above rather than by moving a number.

## Known gaps

- The CLI's own rendering (`reaches` in `work.ts`) is proven end to end through
  the built bundle in `cli.test.ts`, which unit coverage does not count. This
  is why `cli` sits at 0.13%, as every CLI line has since phase 3.
- M3's gate — the nine steps with no terminal, driven by hand — is not this
  session's work. It is what remains before v1.
