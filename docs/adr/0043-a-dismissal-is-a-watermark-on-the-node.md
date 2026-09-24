# 0043 — A dismissal is a watermark on the node

- **Status:** accepted
- **Date:** 2026-09-07
- **Covers:** DESIGN §7.2, the flagged-node flow — where a dismissal lives, what
  it dismisses, and which of §7.2's three actions are new operations

## Context

`flagsOf(board, id).flagged` was derived a step early (ADR 0042) and nothing
rendered it. §2.8 says the flag renders above the diff in the review screen and
survives being accepted; §7.2 says three things can be done with a flagged node
and that nothing happens automatically.

Two of the three had no home. `run` refuses a `done` node, so "run again" is
not `run`. Node creation is `propose`, an agent operation that ADR 0009 put in
the host session — so "open a new node for the fix" from a screen had nowhere
to land.

And "dismiss, with a reason, which is kept" is a stored fact. §7.1 got to say
"no new record type" because the digest is a filter over records that already
exist; that argument does not carry here.

## Decision

**The dismissal is a field on the node record, and it moves a mark rather than
clearing a flag.**

### It is git-tracked, because the flag is

The flag is derived from two timestamps that live in git records — the brief's
approval and the decision's answer — so every clone derives the same flag from
the same facts. A dismissal kept in `local/` (§1.4, disposable by design) would
leave the judgement on one machine and the flag on everyone else's: the next
sync re-raises, for each teammate in turn, a change one of them already judged.

The cost is a field on a strict object, which is a schema version and a
migration (ADR 0020, ADR 0030). `SCHEMA_VERSION` is 3 and `MIGRATIONS` carries
the step; nothing was ever dismissed on a board written before the flag had
actions, so the step writes `dismissal: null`.

### It settles the answer it was written against, not the flag

The flag is two timestamps compared. A dismissal stores its own `at`, and
`stale` measures from the later of the approval and the dismissal:

```
answered > max(brief.approval.at, dismissal.at)
```

So a *later* change to the same decision flags the node again. The alternative
— clearing the flag — makes the second change the silent one, and §2.8's whole
argument is about a change nothing on the board knew about. A brief re-approved
after a dismissal (§2.8's first row withdraws approval) is the newer statement
about what the node was built against, which is why it is a `max` and not the
dismissal alone.

One consequence worth naming: the dismissal outlives the flag it settled, and
that is the point. It is the judgement §7.2 keeps, and the panel renders it
after the flag is gone so a reader knows the last change was looked at rather
than missed.

### `reopen` and `create_node` are operations, and neither runs anything

`OPERATIONS` gains three: `dismiss`, `reopen`, `create_node`. Three, not one,
because they are three different acts — folding them together would give the
surfaces a button whose meaning depends on which branch it took.

`reopen` clears `accepted` and stops. It does not dispatch. Approving and
starting have never been one step, and a reopen that ran the node would be
exactly the automatic re-run §7.2 refuses, with one click in front of it.

`create_node` is not `propose` and does not weaken ADR 0009's line. `propose`
returns a set of nodes, the edges between them and the decisions each one
introduces, against the code as it is now — that needs a model. Opening one
node with a title and its edges needs a person who already knows what they
want. The new node arrives with no brief, so it lands on `needs-brief` and
nothing about it can run until one is written and approved (§3.2).

### The stale list is the canvas narrowed, not a sixth screen

§7.2 speaks of a list, and every node in it is already drawn. So the digest's
"N flagged" count is the way in: clicking it filters the canvas, and the three
actions live in the node panel where the rest of a node's actions already are.
`BUILD-PLAN.md` §2 lists M3's screens and a stale-node screen is not among
them.

The filter keeps finished work even while "done" is hidden. A flagged node is
usually a finished one (§2.8), so applying the done filter to the flagged view
would empty the list the reader just asked for.

`flagged` therefore travels on `ProjectedNode` rather than only in the digest.
The digest is read once, when the board is opened; dismissing a flag has to
take the node out of the list without a reload, and the projection is what the
canvas polls.

### The dashboard gets a DOM, for the components that hold a rule

`vitest.config.ts` said the dashboard's tests are logic and logic needs no DOM,
and that was true while every component was glue. `Flag` is not glue: it
refuses to send a dismissal with no reason, it puts the buttons back when you
change your mind, and it shows what `core` refused with rather than swallowing
it. Those are rules, and a rule rendered by markup is still a rule.

So `apps/dashboard` gains `happy-dom` and `@testing-library/react`, and the
project's `environment` is `happy-dom`. The logic modules are unaffected — they
never touched a document and still do not.

It found one defect on the way in. `Flag`'s `<label>` wrapped the field *and*
the two buttons under it, which makes the label's text part of each button's
accessible name: a screen reader announced "Why it is fine Set it aside" for
the button that sends. The label now wraps the field alone. `Review.tsx` and
`Decision.tsx` were already right, which is what made the mistake easy to miss
by reading.

## Consequences

- A board written by SOBER 3 is refused by an older build, which is D42 working
  as intended: a version that does not understand `dismissal` would drop it on
  the next write.
- The `accept` route reads the review before accepting and now passes
  `found.flagged` through, so `accepted.flagged` is a real fact for the first
  time — it had been `false` on every record ever written.
- Editing an answered decision is still refused (ADR 0015). The path this flow
  is exercised on is a brief approved while the node is `held` and answered
  afterwards, which `approveBrief` permits and which is a real user path. The
  impact preview is the next step in M3 and does not change anything decided
  here.

## Alternatives

**A record beside `local/feedback`.** Costs nothing and is disposable by
design, which is precisely wrong for a judgement §7.2 says is kept: the flag is
shared and the judgement would not be.

**A dismissal that clears the flag.** One boolean, no timestamp comparison —
and the second change to the same decision arrives with nothing on the board
saying so.

**Folding "run again" into `run --again`.** No new catalogue entry, so the
contract test stays quiet on three surfaces. That quiet is the objection: `run`
would start writing board records, and the ability to un-finish a node would
exist without ever being named.
