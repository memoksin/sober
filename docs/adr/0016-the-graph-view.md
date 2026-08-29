# 0016 — The graph view: budget, filter, and where edges come from

- Status: accepted
- Date: 2026-08-28
- Refines: D8, D11, D15

## Context

D8 set the render budget at 1,000 nodes, having lowered it from 10,000 on the
grounds that "one project's real node count is measured in hundreds". The 1,000 was
a rough figure, and the real number is lower still: nodes leave the board
continuously, because `done` work is archived (`PR-08-05`). An active board does
not pass roughly 200.

That figure was carrying more weight than it could bear. D11 rejected React Flow
because "it is DOM-based and 1,000 nodes puts `PR-09-01` at risk" — a reason that
does not survive the correction.

`PR-02-07` required dependencies to be drawn by dragging node to node, and D15
called the canvas "the primary path" for that. After ADR 0009 it is not: edges come
from decomposition. §3.5 already says so — "the agent returns nodes, **the edges
between them**, and the decisions each node introduces." What is left for manual
editing is *correcting* a proposal, which is rare and precise.

Drag-to-connect was also the only criterion separating the candidate libraries, and
the one that made Cytoscape depend on `cytoscape-edgehandles`, last released in
2021.

Node positions were never mentioned. The node record has no `x` or `y`, and
"nodes can be dragged" reads as "and stay where I put them".

## Decision

**The budget is ~200 active nodes**, with 1,000 as headroom rather than a
requirement. Raising the real figure takes an ADR; the headroom does not.

**The canvas filters `done` nodes by default.** A view filter, not a data change —
free, because status is derived. Without it the budget would rest on the user
remembering to archive.

**Drag-to-connect is dropped.** Dependencies come from decomposition and are
corrected as a list in the node panel, which is what D15 already kept for keyboard
reach. `PR-02-08`'s cycle refusal runs when the list is saved, so no live
validation during a drag has to be written.

**`PR-01-04` is unchanged and means moving.** Nodes can still be dragged around the
canvas; all three candidate libraries do that natively. Only edge *drawing* is
gone.

**Node positions are not board state.** Dragging moves a node within the session;
the layout re-simulates when the board opens. This matches `PR-01-03`'s own
reference — Obsidian's graph view re-simulates every time. If persistence is ever
wanted it is per-machine local state, never on the board branch: a shared
coordinate would conflict constantly and mean nothing on a teammate's screen.

**D11 stands as written** — Cytoscape.js or sigma.js, chosen at the start of M3.
React Flow's rejection is kept but its reason is corrected: it ships no force
layout, and `PR-01-03` requires one. With drag-to-connect gone, both remaining
candidates cover every requirement natively and Cytoscape no longer needs a
five-year-old extension.

The spike is one day and asks one question per candidate: does the built-in force
layout feel right at 200 nodes, with circular nodes and hover.

## Consequences

- The library decision gets simpler rather than harder, and `cytoscape-edgehandles`
  drops out of the dependency set entirely.
- M3 loses 1–2 days: drag-to-connect with cycle validation on drop is fiddly work.
- No new fields on the node record.
- The performance budget rests on a default filter rather than a user habit.

## Alternatives rejected

- **Keep 1,000 as a requirement.** It was a guess, and it was excluding a library
  on the strength of a guess.
- **Reopen D11 for React Flow.** Its advantage was the interaction that has just
  been removed; its gap is the force layout `PR-01-03` requires.
- **Store node positions on the board.** A conflict on every node move, over data
  that is meaningless to anyone else.
