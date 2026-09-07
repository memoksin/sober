# 0050 — A run of linked nodes is claimed by its two ends

- Status: accepted
- Date: 2026-09-08
- Moves: `SCOPE.md` SHOULD → MUST #18
- Implements: `DESIGN.md` §3.3, ADR 0005
- Borrows: ADR 0032's confirmation shape, ADR 0025's lock

## Context

ADR 0005 put chain claim on the SHOULD list with a one-line description — "one
developer taking a whole dependency chain as a unit" — and nothing since has
said what a chain is. The gap is not implementation, it is that the sentence
describes three different features and reads as one.

A contributor claims one node at a time. Someone who intends to do a run of five
linked nodes comes back four times, and between each one a teammate can take the
next. That is the cost, and it is paid by the person who planned furthest ahead.

**The new fact** is what happened when the three readings were drawn on a real
graph. "Everything downstream of one node", "everything upstream of it" and "the
path between two named nodes" are not three spellings of one idea: on a board
where two features hang off one shared foundation — a schema, a config, a
database — they return sets that do not overlap.

```
db-setup ← auth-schema ← auth-api ← auth-ui
db-setup ← billing-schema ← billing-api
```

Downstream of `db-setup` is the whole board. An undirected walk from anywhere is
also the whole board, because the shared foundation joins every feature to every
other one — which is the reading closest to "a group of nodes bound to each
other", and the one that turns `claim` into "take everything". Upstream of
`auth-ui` is the auth feature **plus** `db-setup`, which billing also needs and
which is nobody's feature in particular.

## Decision

**A chain is the run between two named nodes: `from..to`.** Both ends are given,
and the run is every node lying on a path from one to the other.

`sober claim auth-schema-m3q8..auth-ui-9x1p` takes exactly the auth run. It does
not reach `db-setup`, because a shared foundation is other people's work as much
as it is this run's, and it does not reach billing at all.

Every path, not one of them. A graph can hold several between the same pair —
a fan-out that rejoins is the ordinary shape of decomposed work — and all of
them are the work between those two ends. `between()` reads this as the
intersection of what `from` reaches going forward and what `to` reaches going
back, which needs no path enumeration and cannot go exponential on a wide graph.

**A run is spelled the same way on all three surfaces**, and read by one parser.
`chainEnds` lives in `schema` beside `ID_PATTERN`, so the CLI, the session and
the dashboard cannot drift on what `..` means. An id holds no dot, so nothing on
the board can be mistaken for a run.

**It is not a new operation.** A run is `claim` and `release` over a set, so
`OPERATIONS` does not grow, the surface manifests do not change, and `PR-09-08`'s
contract test stays green whether or not a surface has it — which is exactly how
parity would break here without anyone noticing. So the run is named on each
surface by hand, in the same test, beside the two operations that are already
folded into others.

**A run crossing somebody else's node is refused whole**, with the names, and
the second call is the confirmation — ADR 0032's shape, in its own vocabulary
on each surface: `--anyway` on the command line, one elicitation for the whole
run in a session. A single claim never refuses (D23) because there is one node
and one person to report; a run can cross several people at once, and taking
five people's work off them in an act nobody confirmed is a different size of
statement. The claim is still a signal and still not a lock: the second call
always goes through.

**A claim is a snapshot, not a standing rule.** Nothing on the board says "these
five were a run" — a run is a claim on each node, exactly the record that already
exists. A node that lands inside the run later, on a teammate's sync, is nobody's
until the command is run again. Storing a chain id would make the claim a rule
that keeps applying, which is a second kind of record and a second thing that can
disagree with the graph.

**Giving a run back is one act too**, and it never touches a node somebody else
holds. Taking a teammate's claim off as a side effect of tidying up my own is the
silent stomp the same-files warning exists to prevent.

**A node in the run that is already done is passed over**, and said out loud. A
claim on finished work says nothing, and rewriting one is the shape of the M2
gate's third defect.

## Consequences

- `schema` gains `chainEnds`. `core` gains `claimChain` and `releaseChain`, and
  `between` inside `graph.ts` without exporting it — surfaces call the two that
  take the lock, never the walk on its own.
- **The export ceiling moves to 103** (ADR 0028). The two names are what a
  multi-record write has to be: ADR 0025's lock covers an action rather than a
  file, so a run cannot be a loop over `claimNode` in three surfaces without
  making half a run visible to the other writer.
- **It moves from 101, not from the 100 `BUILD-PLAN.md` §7 still named.** The
  auditor raised `CEILING` to 101 in code and said so nowhere — not in ADR 0049,
  not in §7's alarm list — which is the silent move ADR 0028 exists to prevent,
  made by the mechanism meant to prevent it. §7 is corrected to 103 here, and
  the correction is recorded rather than folded in, because a number that drifts
  once will drift again unnoticed if nobody says it did.
- `OPERATIONS` is unchanged, and so are `CLI_COVERS`, `MCP_COVERS` and the
  server's route keys.
- **The same-files warning does not fire on a run.** Its members share files by
  construction — that is what makes them a run — so a warning on every pair
  would mean nothing. The load-bearing check is untouched: `run` still refuses
  at dispatch (ADR 0032), per node, for every node in the run.
- `sober claim` and `sober release` take an id or a run in the same argument.
  No new command, no new flag beyond `--anyway`, which `run` and `edit` already
  spell the same way.

## Alternatives rejected

- **Everything downstream of one node.** Bounded by nothing: on the board above,
  `db-setup` returns every node there is. "I will do this whole thing" and "I
  will do everything this unlocks" are different sentences, and only the first
  is a person describing their own work.
- **Everything upstream of one node.** The reading that survives longest — it is
  bounded by a goal and terminates on its own — and it still sweeps in the shared
  foundation every other feature is waiting on. Claiming `db-setup` as a side
  effect of claiming the auth feature announces something about billing that
  nobody said.
- **The undirected group: every node an edge can reach.** Closest to the plain
  words "a group of nodes bound to each other", and measured against a real
  shape it is the whole board, because one shared foundation joins every feature
  to every other one.
- **A chain id stored on each claim.** Makes the run survive a sync, and makes a
  claim a standing rule rather than a fact — schema v5, a migration, and a second
  record type for the one thing `SCOPE.md` says a claim is not.
- **Take what is free and report the rest.** Half a run is not a unit, and it
  leaves the person holding a set they now have to reason about node by node —
  which is the four-trips-back cost this feature exists to remove.
- **Take it and queue the rest.** A pending claim is a new record and a new thing
  the graph can disagree with. `SCOPE.md`'s claim is a fact about now.
- **A `--chain` flag beside the node argument.** `from..to` cannot be anything
  else, so a flag would be a second way to say what the argument already says.
- **A new operation, `claim_chain`.** It would grow `OPERATIONS`, three manifests
  and the route table for something that is `claim` with a wider target. `release`
  is already folded into `claim` on one surface for the same reason.
