---
description: How SOBER's loop works — the graph, the one hard block, briefs and approval, dispatch, and review. Use when the user mentions SOBER, a SOBER board or node, asks to plan work as a graph, or when any sober tool has been called.
user-invocable: false
---

# The loop

SOBER plans work as a graph, then dispatches agents into it. One loop, always in this order:

**plan → decide → brief → approve → run → review → accept**

Nothing skips a step. Each one exists because the step after it is worse without it.

## The tools

SOBER's tools come from the `sober` MCP server. Call them as tools. Do not read
`.sober/` by hand, do not shell out to reproduce one, and do not write a script
that simulates what a tool would have returned — a reconstructed board is a
guess, and the ids in it are invented. If a tool you need is not there, say so
and point at the command line, which does all of it.

## The graph

A node is one piece of work: one agent finishes it, one human reviews it in one sitting. Edges are dependencies — what must land before what. A dependency that would close a cycle is refused, and the cycle is shown.

**Status is derived, never set.** A node is `held` while a decision it binds is unanswered, `blocked` while something it depends on is not accepted, `needs-brief` until one is written, `ready` once the brief is approved, `running`, `in-review`, and `done` once a human accepts. There is no field to set and none to forget. If you want a node's status to change, change the thing it is derived from.

## The one hard block

A decision is a question whose answer changes the shape of more than one node. Four categories, and no fifth: `state`, `module-boundaries`, `data-flow`, `error-handling`.

Every node bound by an unanswered decision is held, and no amount of work routes around it. That is deliberate: the alternative is an agent guessing at an architectural choice and twenty files inheriting the guess.

**The answer is the user's.** Ask with this host's own question tool and pass `decide` exactly the option they picked, one decision per call — never a list, never a summary followed by a single confirmation. {{ask}} Do not pick for them, and do not treat their earlier remarks as an answer.

Every option carries two things: why someone picks it, and **what it costs later**. Write both for this repository, not in general. That pair is the whole of what makes the choice theirs rather than yours.

{{spawn-guard}}

An answered decision cannot be changed in this version, and the tool says why: every brief built on it would have to be withdrawn, and the preview that shows which ones is not built yet.

## Briefs and approval

A brief is the approach — how the work gets done, in this codebase, naming real files — and the acceptance list: commands that can actually be run here, each with what passing it proves.

Approval is the user's, one node at a time. Nothing runs without it. Rewriting an approach clears the approval it had: the approved thing was the old approach.

## Running

`run` cuts the node its own worktree and branch, prepares it with the configured setup command, and hands the agent the brief — rendered at the moment it runs, with the answered decisions in it and the last rejection above it. Nothing outlives its time limit.

A run that fails is read, not retried blind: `logs` says what happened.

## Review is checks, not reading

The scan runs over the added lines of the diff and reports named signals — a secret, a dependency added, a lockfile changed, a file outside the node's declared globs, and the rest. A scanner that could not run is never reported as clean; it says it did not run.

Read the findings first, then the acceptance criteria, then the file list. Ask for the diff when the findings or the criteria give you a reason to. A reviewer who reads every line to find the problem is doing the scan's job by hand.

**Accepting is the user's**, and it is recorded with their name and with how the scan read at that moment — including "the scan did not run". Merging happens only after they say yes.

**Rejecting deletes nothing.** The branch, the worktree and the work all stay, and the next run carries the rejection alongside the brief. Send it back with what was wrong in the words the next run should read, not with a verdict.

## What never happens

- An agent answering a decision, or approving a brief, or accepting work.
- A batch accept of decisions, or of approvals.
- A node's status written into a record.
- Work dispatched onto a node that is held, blocked, or has no approved brief.
- A proposal replacing or deleting accepted work. Re-planning adds.

## Where things are

`.sober/` on the code branch: one file per node and decision, plus `config.jsonc` with every setting and the reason for each. Local, disposable state — runs, logs, rejections — lives under `.sober/local/` and is never shared.

Every command is available on the command line too (`sober --help`), for hosts with no plugin. The board is the same board.
