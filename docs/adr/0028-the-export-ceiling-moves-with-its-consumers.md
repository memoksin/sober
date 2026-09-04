# 0028 — The export ceiling moves with its consumers

- Status: accepted
- Date: 2026-09-04
- Refines: ADR 0023, BUILD-PLAN §7

## Context

`BUILD-PLAN.md` §7 ships two defences against the failure that ended v0's `core` — 291 exports across 28 modules, grown without anyone noticing:

1. **A public-surface snapshot per package.** Adding a name means updating a committed snapshot in the same pull request, where a reviewer sees it.
2. **An alarm beside it**: `core` exports over 60 emits a CI warning and asks for an ADR (REVIEW-2026-08-29 §3.6). It exists for the day a tired reviewer updates a snapshot without reading it.

The 60 was chosen in phase 0, when `core` had no consumers at all. It has now been hit twice by ordinary work:

- Phase 2 fired it at 74 and the surface was **pruned to ~55** rather than the ceiling raised. That was the right call: most of those names had no consumer.
- Phase 3 fires it again at 77, and this time the pruning is already done — six names with no consumer were removed, and every remaining export is called by `packages/cli`. `packages/mcp` and, in M3, `packages/server` are two more consumers of the same functions.

The second case is not the failure the alarm was built for. A ceiling that fires on a package doing exactly what it is for stops being read, which is how v0's rules died: they were all true, and none of them was a check.

## Decision

**The ceiling is 90, and it moves by ADR when a milestone adds a consumer to `core`.** It stays a warning, never a build failure.

The **surface snapshot stays the hard guard**, unchanged. It is the check that actually catches growth, because it names every added export in the diff. The ceiling is the second line, and a second line that cries wolf is worse than none.

**What shaves it is the deletion pass**, not the number: `BUILD-PLAN.md` §7.4's weekly thirty minutes with `knip` and `depcheck`. An export with no consumer comes out then, at a moment when the whole surface is being read at once — which is a better moment to judge one than the middle of a feature.

The number is a judgement, not a measurement, and it is written down so the judgement is visible: `core` has three consumers in v1, each of which reads the board, writes records, dispatches, scans and reviews. Roughly thirty names per surface area — storage, graph, git, dispatch, review, decisions — is the shape of a package that owns all of them.

## Consequences

- `BUILD-PLAN.md` §7's alarm list changes from 60 to 90. `CEILING` in `packages/core/src/exports.test.ts` follows it, in the same commit.
- The other two alarms are untouched: the dashboard-to-core line ratio, and a phase past 1.5× its estimate.
- Phase 3 lands at 77 with the alarm quiet, and the next raise needs an ADR of its own. If M3 pushes past 90, that ADR is also the moment to ask whether `core` should be two entry points rather than one — the question this ADR deliberately does not answer yet, because `server` does not exist and the split would be guessed rather than observed.
- The weekly deletion pass gains a named job it did not have: read the surface snapshot, not only the dead-code report.

## Alternatives rejected

- **Keep 60 and prune to fit.** The pruning is already done. What is left is what the CLI calls, and removing an export a consumer uses to satisfy a number means re-adding it in the next commit — a ratchet that trains people to work around it.
- **Remove the ceiling and trust the snapshot.** The snapshot catches every addition but only asks "is this line intended?", never "is the surface still small?". v0's 291 exports arrived one intended line at a time.
- **Split `core` now, one entry point per surface.** Speculative: `server` is M3 and `mcp` is not written yet, so the split would be drawn from a guess about what each imports. It stays on the table for the ADR that raises 90.
- **Make the ceiling a ratchet, like coverage — never higher than the last commit.** That is the surface snapshot with a worse error message.
