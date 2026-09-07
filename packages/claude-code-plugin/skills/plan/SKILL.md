---
description: Plan work as a SOBER graph — nodes, the edges between them, and the decisions they bind. Use when the user wants to plan or decompose work on a SOBER board.
argument-hint: what you want built, in your own words
---

<!-- Generated from plugins/skills/plan/SKILL.md by scripts/build-plugins.mjs. Edit the source, then run `pnpm plugins`. -->

> **These are tools, not commands.** Everything named in backticks below —
> `board`, `propose`, `decide`, `run` and the rest — is a tool of the `sober`
> MCP server SOBER installs into this host. Call it as a tool. Never reproduce
> one with `bash`, never read `.sober/` by hand, and never write a script that
> stands in for one: the board you would reconstruct is a guess, and a guess
> with real ids in it is worse than no answer. If a tool is not available, say
> so and stop — `sober --help` on the command line does all of it.

The user wants to build: **$ARGUMENTS**

Plan it as a graph on the SOBER board. Work in this order and do not skip ahead.

1. Read the board first (`board`). If there is none, `init` it. If there are already nodes, you are **adding** to the graph — never replacing or deleting accepted work.

2. Read enough of this repository to propose something specific to it. A proposal that would fit any project is a proposal nobody can accept: name real directories, real files, the framework that is actually here.

3. Decompose into nodes. A node is one piece of work one agent can finish and a human can review in one sitting. For each: a title, a description someone who did not plan it can act on, and the file globs it is expected to touch. Draw the edges: what must land before what.

   **Code and its tests are one node, never two.** A node whose tests live downstream cannot state an acceptance criterion anybody can run, and review has nothing to check. The same goes for a type and its implementation, or a module and its export: if the two land separately, neither one is reviewable on its own.

4. Open a decision **only** where the answer changes the shape of more than one node — where state lives, where a module boundary falls, how data flows, how errors are handled. Those four are the categories SOBER ships; there is no fifth. A question with one obvious answer is not a decision, it is a detail, and it goes in the node's description.

   For each decision write two to four options, and for every option: why someone picks it, and **what it costs later**. That second half is the point. Someone who already knows the trade-off skims it; someone who does not gets what they need to make the choice theirs.

5. **Every decision must be bound.** Put its `key` in the `decisions` list of each node whose shape the answer changes. A decision nothing binds holds no work — it reads as a question waiting on the user and blocks nobody, which is the opposite of what it is for. `propose` refuses a proposal with a loose decision in it, and writes nothing.

6. Write it all in one `propose` call — nodes, edges and decisions together, using `key` to point one at another. If the proposal closes a cycle it is refused whole and nothing is written; break the cycle and propose again.

7. Show the user what landed: the nodes in dependency order, and each open decision with its options. Then stop.

Do not answer a decision, do not write a brief, and do not run anything. The next step is the user's: `/sober:decide`.
