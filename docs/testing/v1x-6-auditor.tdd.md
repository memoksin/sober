# TDD evidence — the auditor (v1.x item 6)

- Date: 2026-09-07
- Branch: `worktree-auditor`, cut from `main` at `a33956a`
- ADR: `docs/adr/0049-the-auditor-runs-the-acceptance-list.md`
- Source plan: none. The journeys below come from the item's brief and from ADR 0022, ADR 0027 and ADR 0011.

## What was actually missing

The brief described the feature as "nobody runs them". Half of that was already false at `a33956a`: `dispatch()` did run `dispatch.verify` and the acceptance list, and `greenNodes()` already read the results. Three things made the result unreadable, and those are what this change fixes:

1. A command that was not installed came back as an exit code, not as `null`. ADR 0027 §5 asks for `null` so that "did not run" is never read as "passed"; the code read it as **failed** instead, which is the same defect pointing the other way.
2. A run that did not finish wrote `acceptance: []` — "this node asked for nothing" — rather than one `null` per criterion.
3. No surface rendered a result. All three printed `proves` and `run` under a heading asking the human to believe them, and the command output went nowhere.

An earlier read of this repository was made against a stale worktree (`5514eb9`) and concluded that nothing ran at all. That was wrong and is recorded here because the RED run is what corrected it: the first test passed on the first attempt.

## User journeys

1. As a reviewer, when a dispatch finishes I see what each acceptance command did, so I do not have to read the diff to find out whether the work is right.
2. As a reviewer, a criterion nobody could run is never shown to me as passed, and never as failed either.
3. As a reviewer, when a criterion was wrong I can correct it and run the list again without paying for a second dispatch.
4. As a teammate cloning the board a week later, I can see how the acceptance list read at the moment the work was accepted.
5. As the person who owns intent, a failed criterion tells me what is wrong and still lets me accept.

## RED

```
$ pnpm vitest run --project integration audit.test.ts
 ✓ the acceptance commands run when the agent exits, and the record says how each one went
 × a criterion whose command is not installed is “did not run”, never a pass
 × `dispatch.verify` runs in the worktree and lands on the same record
 ✓ the commands run in the node’s worktree, not in the project root
 × what runs is the approved list on the board, not the copy in the worktree
 × a run that did not finish leaves every criterion unrun rather than guessing
 × the output of a criterion is in the run log, where the reason lives
 × `sober audit` re-runs the list against the last run and rewrites its results
 × `sober audit` on a node that never ran has nothing to audit
 ✓ a failed criterion holds the node out of green, and never blocks the accept
 × accepting records how the audit read at that moment, so it travels with the board
      Tests  8 failed | 3 passed (11)
```

The three that passed are the three the previous work had already built. They were kept: a test that passes before the change is a regression guard, and two of them are the properties the ADR's security section rests on.

Failure reasons, checked one by one rather than assumed:

- `TypeError: auditNode is not a function` — the on-demand path did not exist.
- `expected [{ exit: 127 }, ...] to deeply equal [null, ...]` — the missing-command case.
- `expected undefined to be 'failed'` — `accepted` had no `audit` field.
- `expected [] to deeply equal [{ exit: 1 }]` — a run that did not finish erased the shape of the list.

## GREEN

```
$ pnpm vitest run --project integration audit.test.ts
      Tests  13 passed (13)

$ pnpm vitest run
 Test Files  70 passed (70)
      Tests  745 passed (745)
```

## What each test guarantees

| # | What is guaranteed | Test | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | The acceptance commands run when the agent exits, and the record holds one result per criterion, by index | `test/integration/audit.test.ts` | integration | PASS |
| 2 | A command that is not installed is `null` — not `{ exit: 0 }` and not `{ exit: 127 }` — on the record and in the review | `audit.test.ts` | integration | PASS |
| 3 | `dispatch.verify` runs in the worktree and reaches the same record and the same review | `audit.test.ts` | integration | PASS |
| 4 | The commands run in the node's worktree, never in the project root | `audit.test.ts` | integration | PASS |
| 5 | What runs is the list on the board, not the rewrite an agent left in its own worktree | `audit.test.ts` | integration | PASS |
| 6 | A run that did not finish leaves one `null` per criterion, never an empty list | `audit.test.ts` | integration | PASS |
| 7 | A failing command's output is in the run log, where the reason can be read | `audit.test.ts` | integration | PASS |
| 8 | `sober audit` re-runs the list against the existing run and rewrites its results | `audit.test.ts` | integration | PASS |
| 9 | `sober audit` on a node that never ran returns null, and on an unknown node refuses | `audit.test.ts` | integration | PASS |
| 10 | A config the base cannot be read from stops the audit rather than skipping verification | `audit.test.ts` | integration | PASS |
| 11 | A failed criterion holds the node out of `green` and never blocks the accept | `audit.test.ts` | integration | PASS |
| 12 | Accepting records how the list read at that moment, on the node record that travels | `audit.test.ts` | integration | PASS |
| 13 | The terminal review marks each criterion `✓`, `✗` or `?`, and `sober audit` prints the same | `test/integration/cli.test.ts` | integration | PASS |
| 14 | A session's review says `DID NOT RUN` beside a criterion nothing ran | `test/integration/mcp.test.ts` | integration | PASS |
| 15 | The screen renders the three outcomes with three tones, and "did not run" is never a pass | `apps/dashboard/src/review/data.test.ts` | unit | PASS |

Tests 13–15 are the "all three surfaces" half of the item, one test each.

## Coverage

```
$ pnpm coverage:check
cli: 0.12% (baseline 0.13%)
core: 97.62% (baseline 97.6%)
dashboard: 56.49% (baseline 56.45%)
mcp: 94.14% (baseline 94.13%)
server: 94.89% (baseline 94.89%)
```

`packages/core/src/audit.ts`: 100% lines, 91% branches. The uncovered branches are the two `NotOnBoardError` guards that only fire if a record is deleted between a read and a write in the same lock.

`cli` sits at effectively zero and always has: the CLI is exercised through a spawned binary, so nothing attributes to its source. `sober audit` added lines there, which is why the number moves down by 0.01 — inside the ratchet's tolerance, and the command is covered by test 13.

## Other checks

```
$ pnpm lint         # biome + secretlint, clean
$ pnpm typecheck    # 11 tasks, clean
$ pnpm boundaries   # no dependency violations (211 modules)
```

## Known gaps

- The three surfaces are tested for what they render, not for how they look. That is the same standard the rest of the review screen is held to.
- Nothing tests a criterion that hangs. `dispatch.timeoutMinutes` caps the run, and the audit is inside it — but on the `sober audit` path there is no run to cap, so a hanging criterion hangs the command until the user stops it. Named here rather than fixed: the same is true of `dispatch.setup` and `scan.extra`, and one timeout for all three is a change worth making once.
- The ADR was written as 0048 and renumbered to 0049 after a parallel session on v1.x item 4 claimed 0048. Both are unpushed; whoever lands second should check the number again.
