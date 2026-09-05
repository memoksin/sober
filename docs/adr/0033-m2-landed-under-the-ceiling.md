# 0033 — M2 landed under the ceiling, and the deletion pass is what put it there

- Status: accepted
- Date: 2026-09-05
- Answers: the note ADR 0029 asked the next ADR to write

## Context

ADR 0029 raised the export ceiling to 100 for M2 and ended with an instruction: "If M2 lands under 100 with room left, the raise was too generous and the next ADR should say so rather than quietly keep it."

M2 finished at 108 before the deletion pass and **86** after it. The pass removed twenty-two names with no consumer anywhere outside `core` — `withLock`, `dangling`, `topological`, `NotOnBoardError`, `AnsweredDecisionError`, `CycleError`, `DEFAULT_CONFIG`, `GitError`, `LockBusyError`, `StillReferencedError`, `appendEvent`, `branchOf`, `cycleFrom`, `deleteBranch`, `dependents`, `hasRemote`, `readArchivedDecisions`, `readDecisions`, `readLog`, `statuses`, `writeConfig`, `writeProject` — plus seven type aliases that came out with them and changed the count by nothing, exactly as 0029 predicted.

None of them was deleted. Every one still lives in its module and `core` still uses it; only the barrel line went. Re-exporting one is a one-line diff the day something outside asks.

## Decision

**The ceiling stays 100 through M3.** The raise was not too generous: it was measured against a surface nobody had pruned in three sessions, and the honest reading is that 90 was right and the pass was overdue. 100 leaves M3's server the room 0029 was buying without inviting another raise in a week.

**`core` stays one entry point**, for the third time and the same reason: `packages/server` is M3 and does not exist, so the line between entry points would still be drawn from a guess about what it imports. The question moves, again, to the ADR that raises 100 — and if M3 lands under it too, that ADR should lower the number instead.

**What shaves the surface is the pass, not the number.** This is `BUILD-PLAN.md` §7.4 doing the job it was written for, and it is worth recording that the ceiling never once caused a removal: it warned, and a scheduled read of the snapshot removed. The alarm's value is that it made someone look.

## Consequences

- `CEILING` in `packages/core/src/exports.test.ts` is unchanged at 100. The snapshot moves in this commit, where twenty-two removals are visible in one diff.
- Any surface that needs one of the twenty-two back adds a barrel line in the PR that needs it, which is the point of keeping them alive in their modules.
- The next raise, if there is one, is also the next chance to split `core`. Three ADRs have now deferred that; the fourth should either do it or say the question is closed.

## Alternatives rejected

- **Keep 100 silently.** 0029 asked for a sentence either way, because a ceiling nobody revisits is a number nobody reads.
- **Lower it to 90 now.** M3 adds a server and a wire contract to `core`'s consumers. Lowering the ceiling immediately before the phase that grows it is a rule written to be broken.
- **Delete the twenty-two rather than un-export them.** They have consumers inside `core`. Deleting a name the package uses to satisfy a count is how the count wins an argument against the code.
