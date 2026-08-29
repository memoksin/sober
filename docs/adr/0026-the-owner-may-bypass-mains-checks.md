# 0026 — The owner may bypass main's checks

- Status: accepted
- Date: 2026-08-29

## Context

`BUILD-PLAN.md` §7.5 and `STRUCTURE.md`'s bootstrap step 8 both say the same
thing: all six checks required, **no admin bypass**. The reason given is v0's,
and it is measured — v0 allowed the bypass and it was used. "A ratchet with an
override is a suggestion."

Phase 0 turned protection on and hit the other half of the problem. The
repository has one contributor. A ruleset that requires a code-owner review from
`@memoksin` on a branch only `@memoksin` pushes cannot be satisfied: GitHub does
not let an author approve their own pull request. Without a bypass the owner
cannot merge at all, and the escape hatch becomes disabling the ruleset — a worse
outcome than a scoped bypass, because it removes the checks for everyone.

`DESIGN.md`'s own dispatch path also writes `chore(graph):` commits straight to
`main`, which is a second push that is not a pull request.

## Decision

`main protection` (ruleset `21805442`) is active with `bypass_actors` set to the
**Admin** repository role, mode `always`. The rules themselves are unchanged from
what §7.5 asks for: a pull request with one code-owner approval, stale reviews
dismissed on push, the six checks required — `lint`, `typecheck`, `test`,
`boundaries`, `build`, and `integration` on all three platforms — `strict`
(a branch must be up to date), no force-push, no deletion.

The bypass is the owner's, and the owner is one person. Everyone else — every
contributor, and every branch a SOBER dispatch opens — goes through the full
gate.

**This is a deviation from `BUILD-PLAN.md` §7.5 and it is scoped by time, not by
principle.** It is revisited when the second contributor arrives, which is
phase 4's subject anyway. At that point the bypass narrows to `pull_request`
mode or is removed.

## Consequences

- The owner can merge alone, and can push the graph commits `DESIGN.md` §8.3
  describes without opening a pull request for a one-line file.
- The checks still run on every push to `main`, and a red `main` is visible even
  when nothing blocked it. The bypass removes the block, not the signal.
- The honest cost: §7.5's argument now applies to this repository. The discipline
  that stops v0's failure from repeating is no longer enforced by GitHub for one
  account — it is a habit again. The mitigation is that phase 4 removes it, and
  that a bypassed merge is recorded in the ruleset's audit log.

## Alternatives rejected

- **No bypass, as written.** Cannot be satisfied by a single-contributor
  repository: no one can approve the owner's pull request.
- **Drop the code-owner review requirement instead.** That weakens the gate for
  *contributors*, which is the case the requirement exists for. Weakening the
  rule for everyone to unblock one person is the wrong trade.
- **Disable the ruleset until phase 4.** Removes the six required checks as well,
  which is the thing phase 0 exists to install.
