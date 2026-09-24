# 0044 — The preview is a read, and the confirmation is a flag

- **Status:** accepted
- **Date:** 2026-09-07
- **Covers:** DESIGN §2.8, D19 — the impact preview: where it is computed, what
  the save writes, and how many operations it costs the wire contract
- **Closes:** the deferral in ADR 0015

## Context

Editing an answered decision has been refused since M1, in four places saying
almost the same sentence. The refusal was never the design — D19 is — and
ADR 0015 deferred the preview to M3 on one argument: being unable to change an
answer beats changing it without the preview that makes the fan-out visible.

This is that session, and it arrives after two features that changed what it
has to build. ADR 0042 derived the flag from two timestamps. ADR 0043 gave the
dismissal a home and, in passing, widened the flag's definition to *a node
whose bound decision changed after its brief was approved* — with no reference
to the node's status.

## Decision

### Two of §2.8's three rows are written by nothing

`flagsOf`'s `stale` compares `answer.at` against `max(brief.approval.at,
dismissal.at)` and does not look at status. So the moment an edit writes a new
answer, every node built against the old one is flagged — running, in review or
finished alike. §2.8's second and third rows are true by derivation, and this
is the third §7 feature in a row to need no new record (§7.1's digest, §7.2's
flag, and now this).

The first row is the one with a write, and what it writes is the brief's
removal.

### "Re-rendered" was already free; `needs-brief` is the real instruction

`renderBrief` is a read-time render: only the approach and the acceptance list
live on the node, and the decisions section is drawn from the records every
time it is read. So §2.8's "its brief is re-rendered" costs nothing — the
rendered brief showed the new answer before this step existed.

What §2.8 actually asks for is the status: **`needs-brief`, not
`needs-approval`.** Withdrawing the approval alone would leave the node holding
an approach an agent wrote against an answer that is now gone, waiting for a
human to approve it again. That is the rubber stamp `writeBrief` already
refuses to create when it clears approval on a rewrite, one step earlier.

So the save clears `brief` outright. The cost is real and is accepted: the
approach has to be written again by an agent, and the command line has no model
(`AGENT_OPERATIONS`), so a CLI user who edits an answer leaves those nodes on
`needs-brief` until a session writes their briefs. The old approach is not lost
— records are git-tracked — and a node whose brief was never approved is
untouched, because there is nothing there to withdraw.

### The preview is a read, not a stored dry run

`GET /read/impact?decision=…`, computed by `impactOf(board, decision)` — the
same function the save uses to decide what to write, so the preview and the
save cannot disagree.

The alternative pins the fan-out: a dry run returns a token, the save carries
it, and a node that changed in between is caught. It buys that with a stored
fact that has a lifetime — something to write, migrate, merge, expire and
repair — which is the exact trade §7.1 refused for the digest and ADR 0043 paid
only because §7.2 keeps the judgement. A confirmation window measured in
seconds does not earn it. The board is one repository with one lock; the race
this would close is a person and their own agent, and what that person is
protected from instead is the change happening unseen, which the read already
gives them.

### One operation with a flag, not two

`edit_decision` is one entry in `OPERATIONS`. Called without `anyway`, `core`
refuses with `ImpactError` carrying the whole fan-out and writes nothing;
called with it, it applies. That is ADR 0032's shape, not a second one —
`run --anyway` is the same sentence about a different fan-out, and one
confirmation vocabulary is worth more than a preview shaped to each surface.

Each surface spells the confirmation in the register it has:

| Surface | The preview | The confirmation |
| --- | --- | --- |
| Dashboard | the screen: `/read/impact`, rendered above the button | a second click, `anyway: true` |
| Command line | the refusal's fan-out, printed with each node's status | `sober edit <id> <option> --anyway` |
| Host session | one elicitation naming every node it reaches | the human's yes |

The session asks **once for the whole fan-out**, never once per node: a window
per node is how nobody reads any of them (M1 gate, defect 11).

The preview is not in `OPERATIONS` because it is a read, and the catalogue's own
rule is that a surface may read in whatever shape suits it. Listing it would
have made a fan-out nobody is obliged to render into a promise three surfaces
must keep.

## Consequences

- `AnswerLockedError` stops naming a milestone and names the command instead;
  `offer()` stops refusing entirely, because on the screen the preview *is* the
  screen. The option that stands is marked and cannot be re-picked — that would
  move `answer.at` and flag every node built on it for a change that is not one.
- `core` gains three exports (`impactOf`, `editDecision`, `ImpactError`) and is
  at 99 of its ceiling of 100. The next addition moves the ceiling by ADR
  (ADR 0028) or waits for a deletion pass.
- `SCHEMA_VERSION` does not move. This is the point of the two rows that write
  nothing: the last feature to reach this file cost a migration, and this one
  costs a derivation already in place.
- M3's last item is built. What remains for v1 is M3's gate — the same nine
  steps with no terminal, driven by hand.

## Alternatives

**A stored dry run with a token.** Above: a record with a lifetime, bought to
close a race between a person and themselves.

**Withdraw approval and keep the approach.** The command line could then finish
the job alone, which is a real argument. It loses on what it leaves behind: an
approach written against an answer that no longer exists, presented to a human
for approval as though the only thing wrong with it were the signature.

**A `preview_impact` operation beside the edit.** Two entries, three surfaces
declaring both, and a read living in the list of things that change state.

**Apply forward-only, with no preview at all.** §2.8 names this and rejects it:
it leaves half the graph carrying an assumption that is no longer true with
nothing on screen saying so.
