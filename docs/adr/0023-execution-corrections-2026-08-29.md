# 0023 — Execution corrections after the 2026-08-29 review

- Status: accepted
- Date: 2026-08-29
- Amends: `BUILD-PLAN.md` §4, §5, §6, §7

## Context

`BUILD-PLAN.md` is binding on execution and says a change to an order, a gate or
a pace takes an ADR. The 2026-08-29 review measured v0 again and found four things
the plan gets wrong or leaves out. `PLAYBOOK.md` holds the full ruling; this ADR
makes the four corrections binding.

## Decision

1. **Pace.** Phase 0 is 5–7 focused days (was 3–4), phase 2 is 11–15 (was 8–11),
   phase 5 is 10–14 (was 14–20). M1 is 26–36 days; v1 stays 44–62. The first two
   grow because packaging and git plumbing are debug spirals for a junior, not
   reading blocks. The last shrinks because v0's dashboard was 8,892 lines, not
   42,696; the old figure counted `dist/`.

2. **Stuck rule.** Two hours on one error with no progress — one hour in git
   plumbing or packaging — means stop, write three sentences (expected, observed,
   tried), then in order: find an open-source repository that solves it, open an
   ADR draft if the question is architectural, read the tool's own documentation
   from the start if it is a tool. `BUILD-PLAN.md` had no such rule; v0's
   45-commit day is why one exists.

3. **Delegation.** The esbuild bundle script, `publint` and the smoke test move
   from "hand over fully" to "pair": ADR 0007 lists the ways a bundle breaks and
   a junior cannot evaluate a plausible wrong one. Phase 2's git code — worktree,
   merge, lock, atomic write — moves from "solo" to "pair" for the same reason.
   The review unit for everything handed to an agent follows ADR 0022: the
   acceptance list you wrote and the check results, not the diff. §5's cap of
   two agents stays; its condition 3 becomes "you can write both acceptance lists
   and read both check results today".

4. **Alarms.** Three numeric alarms alongside §7's five ratchets. An alarm warns
   and asks for an ADR; it does not fail the build.
   - `core` exports > 60.
   - `apps/dashboard` lines > 1.5 × `packages/core` lines.
   - A phase past 1.5 × its estimate: rewrite the phase gate before continuing.

## Consequences

- `BUILD-PLAN.md` §4, §5, §6, §7 are edited to state these and point here.
- The M1 calendar is 7–9 weeks at four focused days a week.
- Alarm 2 is the only check on the failure that ended v0's last phase; the
  export snapshot only covers `core`.

## Alternatives rejected

- **Four separate ADRs.** All four come from one measurement pass and stand or
  fall together.
- **Leave `PLAYBOOK.md` advisory.** Two documents both claiming to bind
  execution, disagreeing, is v0's "rules as prose".
