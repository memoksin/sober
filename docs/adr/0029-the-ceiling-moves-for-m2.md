# 0029 — The ceiling moves for M2, and `core` stays one entry point

- Status: accepted
- Date: 2026-09-05
- Refines: ADR 0028

## Context

ADR 0028 set the export ceiling at 90 and said the next raise needs an ADR of its own — and that the same ADR is where to ask whether `core` should be more than one entry point.

Phase 4 session 1 crossed it. `sober sync` and the board branch added two names, `sync` and `adoptBoard`, and `core` now exports 91. Sessions 2 to 5 add the conflict surface, contributors, assignment and the pull request; three to six more names is the honest estimate.

There is one correction worth recording, because it will be made again. Two of the four names S1 first added were `type` exports, and removing them changed the count by nothing: types are erased before `Object.keys` ever sees the module. The ceiling counts what exists at runtime. A surface pruned by deleting type aliases is not pruned.

## Decision

**The ceiling is 100 for M2.** It stays a warning, never a build failure, and the surface snapshot stays the guard that actually catches growth.

**`core` stays one entry point.** ADR 0028 put the split on the table for this moment and also said why it would be premature: `packages/server` is M3 and does not exist, so the line between entry points would be drawn from a guess about what it imports rather than from what it does. That reason has not changed in a day. The question moves to the ADR that raises 100.

The arithmetic behind 100 is the same as 0028's: `core` has three consumers in v1, and M2 gives it a whole surface area it did not have — a board that travels, a merge with a human in it, and validation over the merged graph. Roughly ten names for one new surface area is the shape of the package, not growth nobody noticed.

## Consequences

- `BUILD-PLAN.md` §7's first alarm changes from 90 to 100. `CEILING` in `packages/core/src/exports.test.ts` follows it, in the same commit.
- The weekly deletion pass (`BUILD-PLAN.md` §7.4) keeps its job, and gains a note: a name with no consumer comes out, and a `type` export coming out is a readability change, not a count change.
- If M2 lands under 100 with room left, the raise was too generous and the next ADR should say so rather than quietly keep it.

## Alternatives rejected

- **Prune to fit under 90.** Phase 2 already pruned this surface from 74 to ~55 and phase 3 pruned it again. What is left has a consumer, and removing an export a consumer uses to satisfy a number means re-adding it in the next commit — ADR 0028 rejected exactly this and the reason has not weakened.
- **Split `core` now.** Speculative for the reason 0028 gave and gives again here.
- **Raise to 95.** Enough for S2 and not for S5, which means this ADR again in three days. A ceiling re-argued every session is one nobody reads.
