# 0003 — The word is "decision", not "gate"

- Status: accepted
- Date: 2026-08-27

## Context

v0 used "gate" throughout: `sober gate`, `checkGate`, `gate_answers`, a `gated` node status. In its original shape a gate belonged to a node — every node carried its own copy of four categories. 22 of 56 nodes sat gated and none of them opened; four separate nodes existed only to patch the gate. Repetition, not rigour.

v0's own reform (2026-08-27) fixed the mechanism: a decision became its own record, nodes reference decisions and inherit them, and only a node that _introduces_ an open decision is held. The word "gate" survived the reform describing something it no longer named.

## Decision

Drop "gate" from the v1 vocabulary entirely. Schema, CLI, dashboard, and docs all use **decision**.

- A **decision** is a record: a question, 2–4 options each with a reason and a later cost, and a choice.
- A node lists the decisions that bind it, and the subset it introduces.
- A node is held if and only if a decision it _introduces_ is still open. A node that merely references a decision waits on the introducing node like any other dependency.

## Consequences

- No `gated` status, no `gate` command, no `gate_answers` table.
- One answer clears every node downstream of it, which was already true after the reform and is now sayable in one sentence.
- Anyone reading v0 code will see "gate" and must translate. This ADR is the translation.

## Alternatives rejected

- **Keep "gate" and change what it means.** A word that means one thing in the old repository and another in the new one produces a wrong assumption on every read.
- **Use both — decision for the record, gate for the blocked state.** Two words for one mechanism is how the v0 confusion started.
