# SOBER — Charter

What SOBER is, and what it is not. Ported from v0, where it was the one document
that held up. Everything in `SCOPE.md` is derived from this file; nothing is
derived from v0's board.

One word changed in the port: v0 called the hard block "the gate". v1 calls it
what it is — a **decision**. See ADR 0003.

## What SOBER is

An agentic development platform doing three jobs at once:

1. **Orchestration** — a graph of nodes coordinates a small team, human and
   agent, working one project in parallel. Who owns what, what is blocked, what
   can start now.
2. **Automation** — implementation goes to parallel agents. The human thinks, the
   agent types.
3. **Education** — the user finishes a project knowing **why** every decision in
   it was made: what the alternatives were, and what each one would have cost
   later. Not a shipped repo they cannot explain.

The third pillar is deliberately narrower than it once read. `SCOPE.md` states
what serves it in v1 — every option carries its reason and its later cost — and
nothing in v1 measures what a user knows. A claim the product cannot keep would
weigh down the rest of this document. See ADR 0024.

## What SOBER is not

- **Not accelerated vibe coding.** Speed is a side effect, never the goal. A node
  that ships faster while the human understands less is a failure.
- **Not a CLI you watch in a terminal.** The dashboard is the primary surface for
  the board — seeing it, deciding, reviewing, dispatching. A dashboard-shaped gap
  is a product gap, not a missing convenience.

  This is not an objection to planning in a session. **Intent is authored where the
  user already is**: inside their own agent session, through SOBER's tools
  (ADR 0009). The objection is to watching runs scroll past in a terminal.

## The human/agent line

The human owns *intent* — what to build, why, which trade-off to accept. The agent
owns *technique* — how a data flow is laid out, which pattern fits, what the error
path looks like.

When a decision needs knowledge the human lacks, the agent proposes options with
reasons and the human still picks. A proposal the human cannot evaluate is a
teaching failure, not a time saving.

## Where the three pillars meet: the decision

A decision holds work until it is answered (orchestration), records the answer so
the implementing agent needs no second lookup (automation), and is asked at the
level of the person answering (education).

It is SOBER's **one** hard block. Everything else is advisory, because one hard
block is enforceable and five get routed around.

A decision holds every node it binds, not only the node that raised it — one
answer, every node bound by it released in the same write (ADR 0006). The block
is one sentence, which is what makes it enforceable.

Anything that serves none of the three pillars does not belong in SOBER.
