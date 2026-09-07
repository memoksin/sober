# Changelog

Written by hand, one entry per release. Not generated from commits: a commit
message says what changed in the tree, and this says what changed for the person
using it — which is a different list, and usually a shorter one.

The reasons live in `docs/adr/`. Where an entry is the answer to something a
gate found, it says which gate and which finding, because that is the shortest
route to why it is worded the way it is.

## Unreleased — v1

The first version where the loop closes: plan, decide, brief, approve, run,
review, accept, on all three surfaces (CLI, MCP, dashboard). Three milestone
gates were driven on real repositories — M1 and M2 on the command line, M3 with
no terminal at all — and each one's findings were fixed in the commit after it.

### The loop

- **The board is a graph on git.** Nodes, dependencies, and status that is
  derived rather than stored — there is no field to set and none to forget.
- **A decision is the one hard block.** Every node bound by an unanswered
  decision is held, and nothing routes around it. An answer can be changed, and
  the impact preview shows the fan-out before it is.
- **A brief before a dispatch.** The approach and an acceptance list of commands
  that can actually be run. Approval is the user's, one node at a time.
- **Parallel dispatch**, one worktree and one branch per node, each run judged by
  a security scan before anyone reads it.
- **Review is checks, not reading.** The scan, then the criteria, then the
  files — the diff last, and available rather than required.
- **The board travels over git**, so a team shares one board without a server.

### The surfaces

- `sober` on the command line mirrors every state-changing operation, headless.
- An MCP server and a Claude Code plugin put the same operations inside a host
  session, with five skills: `/sober:plan`, `/sober:decide`, `/sober:brief`,
  `/sober:next`, and the loop itself, which the model reads on its own.
- `sober dashboard` serves a canvas, a node panel, a decision screen, a review
  screen, a digest on open and a view of what is flagged. The server outlives
  the browser tab, so closing it mid-run loses nothing.

### From M3's gate

- **Every slow button says what it is doing.** One vocabulary rather than five
  spinners: the review button narrates its scan the way `sober review` does.
- **The panel names the next move**, in a sentence, for every status — including
  the three that offer no button, where a person previously had a colour and a
  word.
- **A brief renders as the markdown it was written in.** Headings, lists, inline
  code and fences, as elements rather than as a string of HTML.
- **`/sober:brief`** is the brief on its own, for when the whole node is not
  wanted in one go.

### Known, and deliberate

- **A run cannot be read from the screen.** `sober logs <node>` on the command
  line is where the agent's output lives, and the panel says so while a node is
  running. ADR 0045 has the reasoning; a live view is v1.x, and SSE is its
  shape.
