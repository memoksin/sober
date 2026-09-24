# 0035 — `core` stays one entry point, and the question is closed

- Status: accepted
- Date: 2026-09-06
- Answers: the instruction ADR 0033 left for the fourth ADR

## Context

Three ADRs have now deferred the same question. ADR 0028 set a ceiling and said
the number moves with the number of consumers. ADR 0029 raised it to 100 for M2
and asked the next ADR to say whether the raise had been too generous. ADR 0033
kept 100, recorded that the deletion pass — not the ceiling — was what shaved
the surface from 108 to 86, and closed with a condition rather than a deferral:
"Three ADRs have now deferred that; the fourth should either do it or say the
question is closed."

Each deferral had the same reason, and it was a good one: the line between entry
points would have been drawn from a guess about what the next consumer imports.
M3 removes the guess. `packages/server` is the fourth consumer and its import
set is knowable before a line of it exists, because ADR 0008 already fixed what
it is — route handlers over `core`, with the browser client reading `schema`
only.

That import set is the CLI's. The server reads the board, opens a decision,
writes and approves a brief, dispatches, reviews, accepts, syncs. It is the same
seven steps from a different surface; `PR-09-08` requires exactly that. A split
made today would put the boundary where today's boundary already is, and buy a
package layout in exchange for nothing.

## Decision

**`core` is one entry point for v1, and the question is closed.** Not deferred:
closed. Reopening it takes a consumer whose slice is demonstrably different from
the CLI's, and the reopening is additive — an `exports` map and the barrel lines
that go with it, in the pull request that needs them.

**The ceiling stays 100 through M3**, unchanged from ADR 0033, and the surface
snapshot stays the guard that actually catches growth. What ADR 0033 observed is
worth repeating because it is the operative fact: the ceiling has never once
caused a removal. It warned, and a scheduled read of the snapshot removed.

**At M3's close the number is read once more.** If the landed surface sits
comfortably under 100, the ADR that closes M3 lowers the ceiling to the landed
figure rounded up, as ADR 0033 asked. That is the only part of this question
still open, and it is about a number, not about a layout.

## Consequences

- `.dependency-cruiser.cjs` gains no subpath rules in M3. Its four boundary
  rules (ADR 0008) are the whole of the boundary, and `packages/server` imports
  `@sober/core` at its root the way `cli` does.
- `CEILING` in `packages/core/src/exports.test.ts` stays 100 through the phase.
  The server's arrival is expected to move the snapshot; that is what the
  snapshot is for.
- Three ADRs' worth of deferral is retired. A reader arriving at 0028 now
  follows the chain to an answer instead of to a fourth "later".
- If M3 pushes the surface past 100, the alarm fires and the response is the
  deletion pass first, a raise second — the order ADR 0033 established.

## Alternatives rejected

- **Split now, along `exports` subpaths.** It draws the current boundary a
  second time in a different notation, and it is not free: five more
  dependency-cruiser rules, tsconfig project references per subpath, and an
  unanswered question about how ADR 0007's bundle inlines a subpath export. That
  is packaging debt taken on at the start of the phase whose stated risk is
  running long.
- **Defer a fourth time.** ADR 0033 ruled this out in advance, and a question
  that four ADRs decline to answer is not a question anyone is really asking.
- **Split later, mid-phase, if the server's imports look wrong.** A boundary
  drawn under schedule pressure in the largest phase is the boundary that
  produced v0's `server.ts`.
