# 0038 — The canvas is Cytoscape.js, and the spike was one-sided on purpose

- Status: accepted
- Date: 2026-09-06
- Refines: ADR 0016, D11
- Partly superseded by [ADR 0040](0040-the-layout-is-placed-not-simulated.md):
  the renderer is still Cytoscape; the `cose` layout was replaced once it met a
  board that was mostly islands. The 1000-node reading below is a reading of
  `cose` animating, and no longer describes anything the product runs.

## Context

ADR 0016 left the library open and promised a spike: one day, both candidates,
one question each — does the built-in force layout feel right at 200 nodes, with
circular nodes and hover.

That promise was written in the same ADR that removed the thing the candidates
actually differed on. With drag-to-connect dropped, Cytoscape.js and sigma.js
both cover every requirement natively, and the only remaining axis between them
is scale: sigma renders with WebGL and wins at thousands of nodes, Cytoscape
draws to a canvas and carries the graph as a queryable model. The budget in the
same ADR is ~200.

So a full two-library day was buying a comparison on an axis this product does
not sit on, in the phase whose named risk is running long (`BUILD-PLAN.md` §4:
compress phase 5 by cutting screens, never checks — and a spike is not a check).

The spike was run one-sided instead: half a day, leading candidate only, with
the fallback stated in advance — if Cytoscape disappointed at 200, sigma would
be measured next and the other half day spent.

## What was measured

A throwaway page, no build step, Cytoscape 3.34.2 from a CDN: 200 generated
nodes with SOBER's eight statuses and a backwards-only edge set, the built-in
`cose` layout, circular nodes coloured by status, hover lighting the closed
neighbourhood and fading the rest, the `done` filter on by default, drag, and a
click that renders what the node panel would fetch.

- **200 nodes: 60 FPS.** The requirement, met with margin.
- **1000 nodes: the render holds once the layout has settled.** The frame rate
  that collapses — to about 5 — is the `cose` simulation *while it animates*,
  not the renderer underneath it. Steady-state pan, zoom, hover and drag are
  fine at the headroom figure too.

## Decision

**The canvas is Cytoscape.js.** Reasons, in the order they will matter to M3:

- **The graph is a queryable model, not only a picture.** The `done` filter, the
  blocked highlight, keeping the canvas selection in step with an open node
  panel, and correcting a dependency list are all reads and writes against a
  graph. Cytoscape carries one; sigma delegates it to graphology and renders the
  result. One of those matches the work M3 actually has.
- **One package.** The force layout is built in — `cy.layout({ name: 'cose' })
  .run()` — against sigma's three (`sigma`, `graphology`,
  `graphology-layout-forceatlas2`).
- **Selector-based events**, the same vocabulary as the styling.

**ADR 0016's spike is amended, not skipped:** half a day, one candidate, one
question, fallback named. The gap this leaves is real and is recorded rather
than implied — **sigma was never measured.** If Cytoscape disappoints in S2 or
S3, there is no comparison to fall back on and the half day is spent then.

**ADR 0016's headroom sentence is corrected in one direction and upheld in the
other.** The renderer holds at 1000; what degrades there is the layout
simulation while it settles. If a board ever reaches that size, the named first
move is settling without animation and fitting once — a layout option, not a
library change. It is not taken now, because `done` work is archived
continuously and an active board does not pass roughly 200.

## Consequences

- One dependency enters `apps/dashboard`. `cytoscape-edgehandles` stays out, as
  ADR 0016 arranged when it dropped drag-to-connect.
- Nothing from the spike enters the product. The page was written to be thrown
  away and is thrown away; what survives is this record and the two numbers in
  it.
- Node positions remain out of the board (ADR 0016, unchanged). The layout
  re-simulates on open, which is also what makes the settle time — not the frame
  rate — the number a user waits on. S2 measures it against a real board.
- D11 is now fully resolved: React Flow's rejection stands on the force layout
  `PR-01-03` requires, sigma is not chosen, and no renderer is hand-written.

## Alternatives rejected

- **The full one-day, two-library spike.** The correct instinct behind it — D11
  once eliminated a candidate on a reason that later collapsed — is answered by
  measuring the leading candidate rather than by measuring both. What it would
  have bought is a number for sigma on an axis we are not on.
- **sigma.js.** WebGL scale we do not need, three packages instead of one, and
  the graph model we do need living in a fourth place. Its reducer pattern is
  genuinely nicer than restyling elements directly; that is not worth the rest.
- **Deciding from documentation with no spike at all.** Half a day is cheap
  against the 1–2 days a mid-phase library swap costs, and the 1000-node reading
  — a simulation cost mistaken for a rendering cost — is exactly the kind of
  thing documentation does not tell you.
