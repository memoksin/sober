# 0072 — The layout runs in the direction of the work

- **Status:** accepted
- **Date:** 2026-09-27
- **Supersedes:** the rings of [ADR 0040](0040-the-layout-is-placed-not-simulated.md).
  Placed, not simulated, stays.

## Context

ADR 0040 placed nodes on rings, ordered by a breadth-first walk. It was written
against a young board: 39 nodes, 22 of them islands. For that board the rings
were right.

This repository's own board is now 102 nodes and 83 dependencies, and most of
it is one connected graph. On it the rings:

- **Crossed 232 times.** Breadth-first order keeps a chain on an arc, but a
  join — one node waiting on four — pulls its inputs from four places on the
  ring, and every one of those edges is a chord.
- **Had no direction.** An edge on a ring points any way. The question a board
  is read for — what waits on what — needed the arrowhead on every edge, and
  the arrowhead was a 0.6-scale triangle in the line's own grey.
- **Lost the selected node's neighbours.** Hover lit them and faded the rest.
  Selection only thickened a rim, so the moment the pointer went to the panel
  the neighbours were gone.

## Decision

**Each connected piece is laid out in columns by dependency depth.**

- A node's column is the longest chain of dependencies under it. Every edge
  points forward: left to right on a wide screen, top to bottom on a tall one.
- A root is pulled up to the column just before the first thing that waits on
  it, so a late root is not a line across the whole piece.
- The order down each column is the mean position of the neighbours already
  placed, swept forward and back four times. The first order is the
  breadth-first walk and every sort is stable, so the same board opens the same
  way twice (ADR 0016).
- A cycle does not stop it: an edge back into the walk is not followed.

**Pieces go onto shelves**, biggest first, in the order `core` reported ties.
A shelf is about 1.25× the square root of the area long on a wide screen, 2× on
a tall one. **Islands come last**, in a grid.

**Gaps follow the label, not the circle.** A label sits under its node, 96px
wide and short. Side by side, two nodes need a whole spacing (112px); stacked,
half of one. So on a wide screen columns are 1.5 spacings apart and rows half a
spacing; on a tall screen the two swap to fit a label.

Nothing can overlap: each node sits on an integer step of a grid, and pieces
are separated by at least one step. The narrowest gap is 56px centre to centre,
38px edge to edge, and the float of ADR 0040 closes at most 7px of it.

**Direction and neighbours are painted, within the palette.**

- Edges use `--edge`, the token the theme already had for them, and the
  arrowhead is `--ink-faint` at 0.8 scale, clear of the rim.
- The selected node's neighbours stay marked while its panel is open: labels in
  `--ink`, edges in `--ink-dim`. It fades nothing, and hover still wins over it.
- Selection follows the panel's `picked`, so a node reached from the panel, or
  dropped with Escape, is the node marked on the canvas.

## Measured

On this repository's board (102 nodes, 83 edges):

| | crossings | mean edge | box |
|---|---|---|---|
| rings | 232 | 2.78 spacings | 1229 × 1216 |
| columns, wide | 53 | 2.34 spacings | 1680 × 1456 |
| columns, tall | 53 | 1.74 spacings | 1792 × 2688 |

On a synthetic dense join — six layers of eight, each waiting on three —
the same columns cross 435 times in walk order and 316 after the sweeps.

## Consequences

- The board is wider than the rings were. `fit` zooms out a little further on a
  monitor, and on a phone the board scrolls down instead of shrinking.
- A layer with many nodes is one tall column. Nothing wraps it yet; a join of
  fifty would make `fit` zoom out past the labels.
- A long edge that jumps columns is still straight and can pass behind a node
  in between. Hover and selection are what make those readable.
- The flow is chosen once, when the shape changes. Turning a phone does not
  re-layout the board.
- The layout still takes a `spacing` and nothing else to tune.

## Alternatives rejected

**Keep the rings and order them better.** A ring has no direction to give, and
any order puts a join's inputs around a circle.

**Cytoscape's `breadthfirst` layout.** It is a layered layout, and it ships in
the package. But it roots by degree or by a given root, has no crossing
reduction, and puts every piece in one set of layers — a board of islands is
one row wider than any screen.

**`dagre` or `elk`.** Better crossing reduction, and a new dependency for a
loop of about a hundred lines. ADR 0038 bought Cytoscape partly for not needing
one.
