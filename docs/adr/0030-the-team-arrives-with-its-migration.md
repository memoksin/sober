# ADR 0030 — The team arrives, and brings the first migration

**Status** accepted · **Date** 2026-09-05 · **Phase** 4, session 3

## Context

M2 adds `assignee` and `claim` to the node, and `contributors.json` to the
board (DESIGN §3.3). The fields were designed in phase 1 and deliberately left
out of the schema until now (ADR 0020), so opening M2 is the first time a board
already in the world has to change shape — the migration infrastructure M1
chose not to build.

Three questions had no answer in `DESIGN.md`, and each one is cheaper to settle
before the code than after it.

## Decision

**1. A claim is written by a command and by a run.** `sober claim <node>` says
"I am on this" before anything starts, and `startRun` writes the same claim when
work actually begins. DESIGN §3.1 says a claim is set when work starts; §3.4
also warns "at claim time, when a teammate takes a node someone else is heading
for", which is only a separate moment if a person can claim without starting.
A claim that appears only when an agent launches is a signal that arrives after
it was useful.

**2. An older board is migrated where a human can be told.** The CLI brings a
board forward when it opens one, and says what it rewrote in one line. The MCP
server does not: it may not write to stdout, and a rewrite of every record on
the board is not something to do silently inside a session. It refuses and names
the surface that can — §2.9's pattern, the same one an elicitation-less host
gets. A newer board is refused on both, because a version that does not
understand a field drops it on the next write (D42).

Migrated records are written back **through the current schema**, so their field
order matches every other record's. Bytes that differ by key order are a
whole-file diff to git and a phantom change to the field-level merge (§1.2.1).

**3. Contributors are added by hand.** `sober contributors add <handle>` puts
someone on the project; nobody is added by acting. A list that fills itself is a
list nobody curates, and `role` and `focus` cannot be guessed from a git config.
The cost is that a claim can name a handle the list does not hold, so `claim`
says so and does not stop — and `assign` refuses an unknown handle outright,
because there it is a typo far more often than a teammate nobody wrote down.

## Consequences

- `SCHEMA_VERSION` is 2, and `migrate.ts` holds one entry per version step.
  Migrations read raw JSON: the schema they move away from is, by then, the one
  the build no longer has.
- The same-files warning fires at claim time (§3.4). The **dispatch-time**
  confirmation in the same section is not built here: the CLI never prompts
  (§4), so what "confirm" means on that surface — and what it does to
  approve-and-queue — is its own decision.
- `core` passes the export ceiling of 100 at 102 (ADR 0029). The deletion pass
  that shaves it found 22 names no consumer outside `core` uses; pruning them is
  its own change, with its own reading.

## Alternatives considered

- **Claim only at run time.** Fewer commands, and it is what §3.1 says on its
  own. Rejected: it collapses §3.4's two warning moments into one and makes the
  claim invisible until the expensive thing has already started.
- **Migrate inside the MCP server too.** One code path. Rejected: the only
  channel that surface has is the tool result of whichever call happened to be
  first, which is not where a person looks for "every record on your board was
  rewritten".
- **Add whoever acts to the contributors list.** No command to forget.
  Rejected: it makes the list a log of who ran something rather than a statement
  of who is on the project, and the two diverge the first time somebody helps
  once.
