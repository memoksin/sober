# 0006 — A decision holds every node it binds

- Status: accepted
- Date: 2026-08-28
- Supersedes: the third decision bullet of ADR 0003

## Context

`DESIGN.md` §2.2 gated on one field: "A node is held if and only if a decision it _introduces_ is still open. A node that only references a decision is not held by it; it waits on the introducing node like any other dependency."

The second sentence was a claim, not a mechanism. Nothing created that dependency. Take a decision two independent branches share — the case §2.1 gives as the reason decisions became their own records. Node `billing-api` binds `error-envelope`, introduces nothing, and has no `dependsOn` path to whichever node does introduce it. Walk §3.2's status order:

- rank 4 `blocked` — no unfinished dependency, so no
- rank 5 `held` — `introduces` is empty, so no
- rank 7 → **`ready`**

The node is dispatchable, and §3.7 renders its brief with an unanswered decision in it. SOBER's one hard block is bypassed by leaving one array empty — and §2.2 itself said `introduces` is "usually empty". That is the normal case, not an edge.

## Decision

**A node is held if any decision in `decisions` is still open.**

The `introduces` field is removed from the node record. Where a decision is answered is derived, not stored: the node binding it that sits earliest in the graph, ties broken by id. The decision screen lists every open decision regardless, so this only picks which node panel offers it inline.

## Consequences

- The gate is one sentence and cannot be bypassed by an omission.
- A shared decision holds every node bound by it. One answer clears all of them in a single write.
- This is not v0's failure returning. v0 blocked 22 of 56 nodes because every node carried its **own copy** of every category, so 22 nodes needed 22 answers. A shared record needs one.
- `blocked` still outranks `held`, so a node with unfinished upstream work reads `blocked`. `held` appears only when the upstream is finished and a shared answer is missing — which is when the node panel's question, "why is this node waiting", finally has a true answer.
- One field fewer in the schema, and the derived answer point cannot disagree with the graph. Same reasoning as status (§3.2).
- If per-decision ownership is ever wanted, it belongs in the decision record, not on a node. It does not bring `introduces` back.

## Alternatives rejected

- **Keep `introduces` as the gate and validate the reference.** Refuse to save a node that binds a decision without a `dependsOn` path to its introducer. Independent branches share decisions on purpose (§2.1); this forces an invented dependency edge between nodes with no work relationship.
- **Derive that edge automatically.** The same defect, applied silently. `blocked` waits for the introducer to be `done`, and `done` means a human accepted its code (§3.1). A node that needed only the answer would wait for someone else's review. That serialises every shared decision and contradicts MUST #4, which requires _parallel_ agents.
