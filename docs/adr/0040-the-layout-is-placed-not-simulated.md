# 0040 — The layout is placed, not simulated

- **Status:** accepted
- **Date:** 2026-09-06
- **Supersedes:** part of [ADR 0038](0038-the-canvas-is-cytoscape.md) — Cytoscape
  stays; its `cose` layout does not.

## Context

ADR 0038 chose Cytoscape on a measured spike and took `cose` with it, because
`cose` ships in the same package. That spike drew a synthetic graph: 200 nodes,
every one of them connected.

A real board is not that. The demo board this was found on has 39 nodes and 22
of them have no dependency at all — which is what a board looks like early,
when work has been proposed and not yet ordered. `cose` on that board did three
things, none of which raised an error:

- **It left nodes on top of each other.** A force layout has no term that
  forbids two nodes sharing a point. It settles into overlaps and only
  separates them when something else disturbs the simulation — which, in
  practice, was dragging an unrelated node and watching a pile resolve itself.
- **It spread.** Islands have nothing pulling them together, so repulsion is
  the only force acting and they push to the edges of whatever room they are
  given. `fit` then zoomed out past the size at which a label can be read.
- **It stacked components into a column.** `cose` packs disconnected components
  one after another without regard for the shape of the screen, so the board
  came out taller than any window and `fit` zoomed out again.

Each was tuned around in turn — `componentSpacing`, then a `boundingBox` of the
viewport, then a clamp on `fit` — and each fix moved the problem rather than
removing it. The tuning had no end because the layout was answering a question
nobody asked: where do these nodes settle under forces? What a person opening a
board asks is: what is here, and what touches what?

## Decision

**Node positions are computed, in one pass, with no simulation.**

Nodes are placed on concentric rings from the middle out. Ring `k` has radius
`k × spacing` and is given `floor(2πk)` places — as many as fit at `spacing`
apart around its circumference. Ring 0 holds one node, at the centre.

The order around the rings is the graph: components in breadth-first order,
biggest component first. Direction is ignored while walking — which way a
dependency points says nothing about which two circles want to be drawn next to
each other.

`spacing` is set by the label, not the circle: an 18px node under a 96px title
needs the title's room, so it is 112px.

Three properties follow, and all three are tested rather than observed:

- **Nothing can overlap.** The chord between two neighbours on ring `k` is
  `2k·spacing·sin(π/floor(2πk))`, which is never below `spacing`; adjacent rings
  are exactly `spacing` apart radially. The guarantee is arithmetic, not a
  parameter that happened to work.
- **It stays compact.** 200 nodes reach ring 8, so the whole board fits in a
  circle of radius `8 × spacing` — about 900px, which a screen shows at 1:1.
  There is no board size at which the layout quietly stops being legible; there
  is only a board size at which you start zooming.
- **It is the same twice.** Positions are not board state (ADR 0016) and are
  computed again on every open. A simulation seeded by randomness gives a
  different picture each time, so the board a person learns the shape of is not
  the board they come back to.

The drag constraint of ADR 0039 §7 changes with it. The pull now starts at the
held node and travels outward one hop per pass, rather than enforcing the
maximum length across every edge at once. Enforcing it everywhere meant the
first drag of a session tidied the whole board: a person moved one node and the
far side rearranged itself while they were looking somewhere else.

## Consequences

- `cose` is gone, and with it the 1000-node reading ADR 0038 recorded as its
  worst number — the 5 FPS there was the simulation animating, and there is no
  simulation. What remains is the renderer, which ADR 0038 measured as holding
  at 1000.
- The picture is less *pretty* than a settled force layout. A force layout
  finds clusters; rings impose an order. On a board that is mostly islands
  there were no clusters to find, which is exactly the case this is for. On a
  board that is mostly one large graph, the ring order is a breadth-first walk
  and reads as a spiral outward from the root rather than as a cloud.
- Edges between distant ring positions are chords. The breadth-first ordering
  keeps connected nodes adjacent, so this is rare, but a node with many
  dependants will have some long ones. The hover focus — neighbours lit,
  everything else faded to 12% — is what makes those readable, and is now load
  bearing rather than decoration.
- The layout takes a `spacing` and nothing else. There are no forces, no
  iterations, and no seed, so there is no tuning surface for a future session to
  spend an afternoon on.

## Alternatives rejected

**Keep `cose` and tune it.** Three parameters were tried and each one moved the
failure. The parameters are real and the tuning would eventually land, but the
result would be a layout that is correct for the board it was tuned against and
unknown for the next one — and "no two nodes overlap" would remain a thing that
usually happens rather than a thing that is true.

**`fcose` or another layout package.** A better force layout is still a force
layout: it would still have no overlap guarantee, still spread islands, and
still start from a random seed. It would also be a new dependency, and ADR 0038
bought Cytoscape partly for having its layouts built in.

**Cytoscape's `concentric` layout.** Closest to this by shape, and it was the
first thing tried. Its ring assignment is driven by a per-node value, and the
natural values — degree, dependants — are properties of the dependency graph.
On a board of islands every node has degree 0 and they all land on one ring.

**One ring for everything.** Simple, and it is what `circle` does. At 39 nodes
the ring is already wider than a screen, and every edge crosses the middle.
