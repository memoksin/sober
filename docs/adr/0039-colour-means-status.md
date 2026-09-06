# 0039 — Colour means status, and the canvas is the application

- Status: accepted
- Date: 2026-09-06
- Decides: the design system every M3 screen inherits, before the first screen

## Context

`BUILD-PLAN.md` §2 lists M3's screens: canvas, node panel, decision screen,
review screen, digest, flagged-node flow, impact preview. Seven surfaces built
across four sessions. A system decided per screen is five systems, and the one
thing every screen shares — the eight derived statuses — is the product's
central idea rather than a decoration.

So the system is decided once, here, and each session then describes only its
own layout. That is the same line `BUILD-PLAN.md` §6 already draws between
specification and typing: the system is specification, a screen's layout is a
description an agent implements.

Tailwind is the stylesheet layer (`STRUCTURE.md`), and v4 is CSS-first: tokens
live in `@theme`, and the dark variant is `@custom-variant dark` against
`[data-theme="dark"]`. Everything below is written as CSS custom properties for
that reason, in three layers — primitive, semantic, component.

## Decision

### 1. Colour answers one question: whose move is it?

Eight statuses, three families, and the family is legible before any label is
read. On a canvas of two hundred circles, "three things are waiting for me" has
to arrive at a glance or the canvas is a decoration.

| Status | Family | What it says | Dark | Light |
| --- | --- | --- | --- | --- |
| `ready` | motion | yours to start | `oklch(0.74 0.16 150)` | `oklch(0.55 0.15 150)` |
| `running` | motion | the agent's; nothing wanted from you | `oklch(0.70 0.14 235)` | `oklch(0.52 0.14 235)` |
| `in-review` | **yours** | a result is waiting on your judgement | `oklch(0.78 0.15 75)` | `oklch(0.60 0.14 75)` |
| `needs-approval` | **yours** | a brief is written and wants approving | `oklch(0.85 0.14 95)` | `oklch(0.66 0.14 95)` |
| `held` | **yours** | a decision holds it and only you can answer | `oklch(0.66 0.17 45)` | `oklch(0.52 0.17 45)` |
| `blocked` | inert | waiting on a dependency, not your move | `oklch(0.52 0.07 300)` | `oklch(0.48 0.09 300)` |
| `needs-brief` | inert | nobody has written one yet | `oklch(0.58 0.02 250)` | `oklch(0.60 0.02 250)` |
| `done` | inert | finished, and filtered out by default | `oklch(0.42 0.01 260)` | `oklch(0.78 0.01 260)` |

Warm is yours. Blue and green are motion. Grey and violet are nothing to do.

**OKLCH, not hex, and the reason is not fashion.** Lightness in OKLCH is
perceptual, so the same hue can move between themes by lightness alone, and the
greyscale separation between `ready` and `held` — the green-versus-orange pair
that colour-blindness collapses — is a number rather than a hope. The three
"yours" statuses sit at L 0.66/0.78/0.85 and the three inert ones at
0.42/0.52/0.58: the two groups do not overlap in greyscale, which is the
property that survives when hue does not.

`done` inverts direction between themes — darker than the ground on dark,
lighter on light — because "recede" is relative to the ground rather than to a
number.

### 2. Colour is reserved for status

Buttons, borders, the selection ring, focus, the top bar: all neutral. There is
no decorative colour anywhere in the chrome, which is what makes every colour on
the canvas mean something. A selected node takes a ring in the ink colour, not
a brand colour, for the same reason.

One exception, named so it stays one: a `danger` red
(`oklch(0.62 0.20 25)` dark, `oklch(0.52 0.20 25)` light) for confirming
irreversible actions. ADR 0036 recorded that `accept`, `archive` and editing an
answered decision are one step on this surface against two on the command line;
this is the only place that asymmetry gets to show. It never appears on the
canvas.

### 3. 13px base, and ids are monospace

A tool, not a document. Base 13px, line height 1.35 for dense lists and 1.55 for
prose, a 4px spacing scale, radii of 4 and 6. The type scale stops at 24px —
nothing here is marketing.

Ids are set in monospace, and that decision comes from the product's own
record. M2 gate finding 7: `invoice-total-using-currencies-module-kxgr` cannot
be typed from memory and nothing helped. Monospace does not shorten it; it makes
it scannable and it makes it read as a thing to copy rather than a thing to
retype.

### 4. The canvas is the application; everything else is a panel over it

Not five routes. The canvas fills the window, a thin top bar carries the project
name, the digest count and search, and a resizable right panel opens for
whatever is selected — the node panel, the decision, the review.

The reason is in `BUILD-PLAN.md` §8's own table: v0's board became 57 patches on
unrecorded decisions. Losing sight of the graph while judging a piece of work is
how a graph stops being a plan. Keeping it behind the panel means every
approval, every answer and every accept happens with the shape of the work still
on screen.

The cost is real and is stated rather than discovered: a diff in a side panel is
cramped. The panel expands to full width on demand, and the canvas is one
`Escape` away.

### 5. Dark is the default; light is real

`PR-01-03` names Obsidian's graph view, which is dark-grounded, and a force
graph reads better there — thin edges, luminous nodes. But the review screen is
where diffs are read, and long reading is not comfortable in the dark for
everyone.

Both themes are complete and both live in the same token file. There is no
toggle in v1: the page follows the operating system and `data-theme` overrides
it, so adding a toggle later is one line. Retrofitting a second theme across
five screens is not.

### 6. Hover grows the node and blooms it in its own colour

Added on review of the proof, before any screen existed.

**Every node carries a rim** — 1.5px, in its own status colour lifted one step
towards the ground's opposite. It gives a disc a defined edge and it separates
two that overlap, which a flat fill does not, and it introduces no colour.

A hovered node grows to **1.2× over 130ms, ease-out**, and takes a **soft bloom
in its own status colour**. Nothing new is introduced by the bloom: it is the
same signal, louder, so §2 holds — a glow in a colour the node does not already
carry would be decoration.

**No glow comes from Cytoscape at all**, and the reason took three attempts to
find. An underlay is a solid shape drawn around the element's bounding box.
`underlay-shape` is meant to make it follow the circle, but a build that does
not know the property ignores it in silence and draws the rectangle anyway —
so a square kept coming back with no error to explain it. An underlay also has
no blur, so even when it does follow the circle it is a hard disc: a halo, not
a glow.

Both states therefore light through **one DOM element each, behind the graph**,
positioned at the node's rendered position and following pan, zoom and the node
itself. One node is hovered and one is selected, so it costs two elements and no
per-node work. Two stacked blurs rather than one: a single blur reads as fog,
two read as light.

**Alpha belongs in the colour, never on the element**, and this is the second
place the black came from. `opacity` on the glow element scales both blurs
together and composites them as one layer, which turns a bright halo into a grey
smear. `color-mix(…, transparent)` is the same trap in CSS: `transparent` is
black at zero alpha, so mixing towards it drags a colour towards black and a
glow fades to grey rather than to nothing. The colours carry their own alpha —
`rgba()` where the source is hex, `oklch(from … / a)` where it is a token.

**Only the pointed-at node.** Its neighbourhood keeps the treatment it already
had, staying lit while everything else fades. This is a design choice and a
performance one at once: Cytoscape's own guidance is that a
`transition-property` belongs on the states that want to animate and never on
the default style, and a neighbourhood of twenty growing nodes on a 200-node
board is exactly the case that warning is about. One gesture, one animation.

**Selection blooms too, and quieter** — 0.22 opacity, 7px — because a selected
node is the anchor while the panel is open. It is context rather than the
pointer, and it should not compete with wherever the pointer goes next.

**The bloom is theme-aware.** A glow is a dark-ground idiom; on light it reads
as a smudge, so the same emphasis arrives as a tighter, denser ring — 6px at
0.22 rather than 9px at 0.32.

**`prefers-reduced-motion` keeps the bloom and drops the growth.** The size
change is the part that moves; the emphasis is the part that informs. Someone
who has asked for less motion should still be able to see what they are
pointing at.

`transition-property` is declared on the hover and selection classes only,
never on the default node style. That is Cytoscape's own guidance and it is not
a micro-optimisation: a transition in the default state makes the animation try
to run far more often than the states that want it.

### 7. An edge has a maximum length, and past it the far node follows

Refines ADR 0016, which ruled that dragging moves a node and that positions are
not board state.

Dragging a node stretches its edges, and an edge stretched across the window
has stopped saying anything about adjacency — which is the only thing this
picture encodes. A dependency drawn as a line to somewhere off-screen is a line
nobody can read.

So an edge has a **maximum rendered length**, and a drag that would exceed it
pulls the far node along instead. The constraint is relaxed over three passes
per drag frame, so a pull travels a few hops out rather than stopping at the
first neighbour; more passes than that is motion nobody asked for. The node
under the pointer never moves — the person is holding it — and where neither
end is held, both give half.

This costs nothing to undo, which is what makes it safe: ADR 0016 already
established that positions live for the session and the layout re-simulates
when the board opens. Nothing here is saved, and nothing a teammate sees
changes.

It is not a physics engine and does not become one. A force layout that keeps
running during a drag is the alternative, and it means a live simulation, an
extension, and a graph that keeps moving after the hand stops.

## Consequences

- `apps/dashboard/src/theme.css` is S2's first file and is written from the
  table above, as `@theme` plus a `[data-theme]` block.
- Each later session describes only its own screen's layout, against this
  system. That is what keeps `BUILD-PLAN.md` §4's "compress phase 5 by cutting
  screens" possible: a cut screen costs a screen, not a system.
- A ninth status would need a home in one of the three families, which is a
  design question rather than a colour-picking one. That is the intended
  friction.
- The `done` filter (ADR 0016) is load-bearing twice over: it is a performance
  default and it is what keeps the dimmest colour off a busy canvas.

## Alternatives rejected

- **Eight distinct hues, one per status.** Maximum distinguishability and no
  meaning. A person would learn eight arbitrary pairings instead of reading
  three families, and the thing they actually want from a glance — "what wants
  me" — would take eight comparisons.
- **A brand accent colour.** It would compete with the statuses for attention
  on the one screen where attention is the whole point, and there is no brand
  to serve: this is a tool a developer runs beside a terminal.
- **Five routes with navigation.** Familiar, and it puts a page transition
  between a person and the graph at exactly the moments the graph matters most.
- **Light-only, or dark-only.** Dark-only costs the review screen; light-only
  costs the canvas. The token layer makes carrying both nearly free now and
  expensive after five screens exist.
- **16px base.** The comfortable default for documents, and wrong for a screen
  whose job is to show two hundred nodes and a dense record beside them.
