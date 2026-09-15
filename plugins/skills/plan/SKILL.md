---
description: Plan work as a SOBER graph — nodes, the edges between them, and the decisions they bind. Use when the user wants to plan or decompose work on a SOBER board.
argument-hint: what you want built, in your own words
---

> **These are tools, not commands.** Everything named in backticks below —
> `board`, `propose`, `decide`, `run` and the rest — is a tool of the `sober`
> MCP server SOBER installs into this host. Call it as a tool. Never reproduce
> one with `bash`, never read `.sober/` by hand, and never write a script that
> stands in for one: the board you would reconstruct is a guess, and a guess
> with real ids in it is worse than no answer. If a tool is not available, say
> so and stop — `sober --help` on the command line does all of it.

{{intent}}

Plan it as a graph on the SOBER board. Work in this order and do not skip ahead.

1. Read the board first (`board`). If there is none, `init` it. If there are already nodes, you are **adding** to the graph — never replacing or deleting accepted work.

2. Read enough of this repository to propose something specific to it. A proposal that would fit any project is a proposal nobody can accept: name real directories, real files, the framework that is actually here.

3. **Where two readings of the request would produce different nodes, ask before you decompose.** Name the two readings and put them to the user with this host's own question tool, then wait. Do not ask an open "what did you mean", and do not write the question into a node's description. Where the request is already specific, ask nothing: an invented question costs the user a turn and teaches them to skim the next one.

   This question is **not one of the four decision categories**. A question about where state lives, a module boundary, data flow or error handling is a decision: it goes on the board in step 5, not here.

4. Decompose into nodes. A node is one piece of work one agent can finish and a human can review in one sitting. For each: a title, a description someone who did not plan it can act on, and the file globs it is expected to touch. Draw the edges: what must land before what.

   **Check each new node against the board, not only this plan.** For each new node, name which nodes already on the board it must wait on, and which of them must now wait on it — same area, same design surface, same record or tool. The first goes in its `dependsOn` in the `propose` call. The second cannot: `dependsOn` only points backwards. After `propose` returns, read the overlap block it printed — open nodes sharing files with a new node and no edge to it — and call `bind` for each edge that belongs, passing the existing node's **full** `dependsOn` plus the new id, because `bind` replaces the list. This was not possible before: the `board` tool renders titles only, so the files and descriptions of earlier nodes were out of sight. The overlap block is that information, delivered when it is useful.

   **Code and its tests are one node, never two.** A node whose tests live downstream cannot state an acceptance criterion anybody can run, and review has nothing to check. The same goes for a type and its implementation, or a module and its export: if the two land separately, neither one is reviewable on its own.

5. Open a decision **only** where the answer changes the shape of more than one node — where state lives, where a module boundary falls, how data flows, how errors are handled. Those four are the categories SOBER ships; there is no fifth. A question with one obvious answer is not a decision, it is a detail, and it goes in the node's description.

   For each decision write two to four options, and for every option: why someone picks it, and **what it costs later**. That second half is the point. Someone who already knows the trade-off skims it; someone who does not gets what they need to make the choice theirs.

   **A question this repository has already answered is still asked, but not from scratch.** Before you write the options, read what the project has already settled: `docs/adr/` and anything else ADR-shaped, `CLAUDE.md` or `AGENTS.md`, the dependencies in `package.json` or whatever manifest is here, and the directory layout and the imports between directories. Where that settles one of the four categories, write the choice this project already made as an option, put its id in `suggested`, and set `derived` to where you read it — a path, a file, "the import graph". Write the other options anyway: a choice with nothing beside it is not a choice, and a project changes its mind.

   `derived` is not an answer and does not skip anything. The question still goes to the user through `{{decide}}`, one decision at a time, and the record then says the answer was read off the code and confirmed rather than arrived at. Never set it to a guess: if you are inferring what somebody would probably have chosen rather than reading what they did choose, leave it empty.

   What you read off the code that is not one of the four categories is not a decision. Do not stretch a category to hold it and do not invent a fifth. Say it back to the user at the end, in one line each — "this repository also settles X, which is not one of the four, so it is not on the board" — and leave the board alone.

6. **Every decision must be bound.** Put its `key` in the `decisions` list of each node whose shape the answer changes. A decision nothing binds holds no work — it reads as a question waiting on the user and blocks nobody, which is the opposite of what it is for. `propose` refuses a proposal with a loose decision in it, and writes nothing.

7. Write it all in one `propose` call — nodes, edges and decisions together, using `key` to point one at another. If the proposal closes a cycle it is refused whole and nothing is written; break the cycle and propose again.

8. Show the user what landed: the nodes in dependency order, and each open decision with its options. Then stop.

Do not answer a decision, do not write a brief, and do not run anything. The next step is the user's: `{{decide}}`.
