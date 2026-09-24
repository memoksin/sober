# 0032 — The dispatch confirmation is a second command, and the queue is read where the graph moves

- Status: accepted
- Date: 2026-09-05
- Closes: the question ADR 0030 left open
- Implements: `DESIGN.md` §3.4, D26 / ADR 0017, `PR-05-06`

## Context

Two things specified since the first draft had never been built, and phase 4's last session found them side by side because each one is the other's safety rule.

**§3.4's second moment.** The same-files warning was to fire "at claim time, when a teammate takes a node someone else is heading for" and again "at dispatch time, on any wave, including a single user's own — and there it asks for a confirmation before starting". Session 3 built the first. The second had nowhere to go: §4 says the CLI never prompts, so what "a confirmation" means on it was undecided, and ADR 0030 recorded it as open rather than guessing.

**D26's second half.** "Approve and queue" records the same human approval of the same brief "plus the instruction to dispatch when the node becomes ready, without asking again". `approval.queue` was written by both surfaces from phase 3 onward. Nothing read it. There was no automatic dispatch at all, which means ADR 0017's three safety rules governed a mechanism that did not exist — including §3.4's own consequence, that "an overlapping node is never dispatched unattended".

So the flag that pays back planning time paid nothing back, and the warning that makes it safe had no second moment. Neither is worth building without the other.

## Decision

**The confirmation is a second command.** `sober run` on a node whose `files` meet an active node's is refused once, before the worktree is cut and before anything is spent, with the overlap named and `--anyway` printed under it. The second command is the confirmation.

This is not a block, which is what §3.4 asks for. A dialog and two commands are the same act with the same information in front of the same person; on a surface with no dialog, the second command is the shape it has. The MCP server has elicitation, so there it stays a dialog — one question for a whole wave, because one window per node is how nobody reads any of them (M1's gate, defect 11).

**A wave counts as active against itself.** `PR-05-06` covers "a single user's own parallel wave", whose members are not claimed by anyone because nothing has started them. They are checked against each other as well as against the board, and the check runs over the whole wave **before the first node starts** — a wave must not spend on its first node and then report a collision its second was always going to have.

**The queue is read where the graph moves.** There is no daemon and no watcher. A node becomes ready when a dependency is accepted or a decision is answered, so `accept` and `decide` — on both surfaces — read the queue after they write. What they start, they say out loud: this is the one place SOBER spends money on a command that was not pointed at a node.

**Four things the queue will not start**, which together are ADR 0017's three rules:

1. A node that is not `ready`, or whose approval does not carry `queue`.
2. A node that has **already run**. A failed run leaves the node `ready` again (D39) and so does a rejection (§6.4); neither may be started a second time by something nobody is watching. From then on it is the human's.
3. A node whose files meet an active node's, or another queued node's — §3.4's automatic consequence, and the reason this ADR is one ADR.
4. A node **someone else has claimed**. Found by driving it: a teammate's claimed node started from the other clone, cutting a worktree and spending money at the wrong machine. A claim is a signal and never a lock (D23), and this is the queue reading the signal.

## Consequences

- `sober accept` can now take minutes, because the node it frees may start. It says which node and on what ref before it does.
- `core` gains `runQueue` and `OverlapError`; `dispatch` gains `anyway` and `alsoStarting`. `Overlap.by` becomes nullable — a wave member has nobody on it yet.
- `dispatchWave` returns its results aligned with the wave it was given, truncated at the first node nobody reached rather than compacted. Compacting put one node's result under another node's name as soon as refusals could appear anywhere in the list.
- D26's trade is now real and visible: the approach was approved before the upstream result existed. It is still per node and still never the default.

## Alternatives rejected

- **Warn at dispatch and start anyway.** The warning already exists at claim time; a second one nobody has to answer is a line of output, not a confirmation, and §5.3's "waits rather than running unattended" would have nothing to hang on.
- **Prompt when the terminal is interactive.** Two behaviours for one command, and the one that runs in CI is the one nobody tested. The CLI's own rule — the answer arrives as an argument (`sober decide`, `sober resolve`) — already covers this case.
- **A daemon, or a watcher on the board.** A second long-lived process to own state that two commands already know. `sober accept` knows the graph moved because it is what moved it.
- **Start a queued node the moment its brief is approved.** Approval is not readiness; the node may still be blocked. This is what "when the node becomes ready" already says.
