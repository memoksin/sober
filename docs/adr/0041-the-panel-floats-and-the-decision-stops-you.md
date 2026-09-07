# 0041 — The panel floats, and the screens that stop you

- **Status:** accepted
- **Date:** 2026-09-06
- **Covers:** the node panel, the decision screen and the review screen

## Context

The canvas answers two questions: what is on this board, and what touches
what. It answers no others, on purpose — a circle carrying a status colour and
a title is the whole of ADR 0008's projection.

Every remaining question about a node is a different act. "Why is this one not
moving" is read at a glance and closed. "Which of these three options do we
live with" is the thing SOBER exists for, and it is not a glance.

## Decision

**Two weights, and no router.**

The node panel is a 420px drawer over the right edge of the canvas. The
decision screen is a 640px card in the middle, over a backdrop that pushes the
board back.

### The panel floats over the canvas rather than sitting beside it

A drawer that takes width from the canvas changes the canvas's size, which
re-runs `fit`, which moves every node on screen. Somebody clicks one node and
the other 199 rearrange themselves — the jump `sameShape` (ADR 0040) exists to
prevent, arriving through the other door.

### There is no route behind either of them

The app has no router and one screen is not a reason to grow one. It is also
not what a router would buy: the board underneath is the context the answer is
being given in, and navigating away from it to answer a question about it is
the wrong shape. Escape closes one layer at a time, so a decision opened from a
node goes back to that node.

### `waitingOn` is derived once, in `core`, and travels on the wire

The panel's central line is what a node is waiting for. The CLI already
derived it, privately, mixed into the expression that coloured it
(`cli/src/status.ts`). The browser cannot import `core` — the
`dashboard-is-browser-only` boundary rule exists for exactly this — so the
options were a second implementation in the browser against the wire shape, or
one implementation on the server.

It is one, in `core`, computed into `GET /read/board`. `Waiting` lives in
`schema/wire.ts` beside `ProjectedNode`, for the same reason that does: a wire
shape belongs to both ends of the wire.

The CLI keeps its own presentation. A column says one kind of wait at a time,
because "waiting on a decision and two nodes" is a panel's sentence and not a
column's. What the two surfaces now share is the answer, not the wording.

### A wait nothing can answer is said, not dropped

An archived decision is not in the open list. A node held by one is waiting on
something no surface offers to answer, and a panel that filters it out renders
a node held by nothing that is still not ready — the worse of the two things to
show (DESIGN §8.4). It stays in the list, marked, in the danger colour.

### The refusal carries its reason

Answering an already-answered decision is refused in this version, because
every brief built on the answer would have to be withdrawn and the preview that
shows which ones is later work in M3. The screen says that sentence rather than
greying out a button: a disabled control with no reason beside it has replaced
an argument with a shrug.

The same is true of a decision nobody has opened. It has no options because
options are generated in a session, against the code as it is now — so the
screen says that, and does not offer an empty list.

### The review is the second stopping screen, and it is wider

It shares the decision screen's shell — a card in the middle, the board pushed
back — because accepting work is the same kind of act as answering a question.
It is 900px against the decision's 640, because four option cards read at 640
and a diff does not.

Its order is ADR 0022's argument made visible: the scan, then CI, then what you
asked the work to prove, and the diff last and folded. A reviewer who reads
every line to find the problem is doing the scan's job by hand.

Turning work down asks for the note before it offers the button. The note is
carried into the next run, which is the thing that makes rejecting cheaper than
fixing by hand — and a "reject" that took no reason would throw that away.

### A node's next step is one row under its title

`actions` maps a derived status to what can be done with it, and nothing else
decides. Approving and running are never offered together: they are one step of
the loop and two acts on the board, and offering both is offering to start work
nobody has read. A node that is `done` offers its review as a record and never
a second accept — which M2's gate found in the terminal, where the second
accept then had no branch left to merge.

The panel does not decide what is allowed; it decides what to offer. `core` is
still what refuses, and its sentence lands under the button rather than in a
console.

### The full board is read only while something is open

The canvas polls the slim projection every two seconds (ADR 0008, ADR 0036).
`GET /read/board` carries full records and is polled on the same timer, but
only while a panel or a decision is open — a drawer that is not there needs
nothing at all.

After an answer lands, the board and the projection are both read back rather
than patched on screen. The answer frees whatever was held by it, and the board
is what knows which.

## Consequences

- `core` gains one export, `waitingOn`, and `schema` gains one, `Waiting`. Both
  went past the export ratchets deliberately, which is what the ratchets are
  for.
- The dashboard can now write. `wire.op` posts to `/op/<name>` through the same
  `send` the reads use, so the two cannot come to disagree about the token
  header or about what a failure means.
- Nothing here is tested through a DOM. What is tested is what the components
  read: `held` resolving a wait into a question or a title, and `offer` saying
  what a decision offers. The rendering is verified by hand, which is what
  every phase-5 session ends with.
- Five of the M3 gate's nine steps are now reachable with no terminal:
  approve a brief, start a run, read the review, accept or turn down, and watch
  a downstream node come off `blocked`. What is left for later sessions is the
  digest, the flagged-node flow and the impact preview.

## Alternatives rejected

**The panel as a third column beside the canvas.** It is the more ordinary
layout and it is what a router would want. It also resizes the canvas, and the
canvas has spent a whole session earning the property that nothing moves unless
a person moved it.

**The decision as a second drawer.** One element, two contents, a back arrow.
Less code than a modal and the wrong shape: four option cards, each carrying a
label, a reason and what it costs later, do not read at 420px, and the act of
answering should not feel like the act of glancing.

**A `decision` read of its own.** `GET /read/board` already carries every
decision. A second route for one record would be a route whose only reason to
exist is that the screen was written before anybody checked.
