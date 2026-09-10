---
description: Write the brief for one SOBER node — the approach and the acceptance list — and put it to the user for approval. Use when the user asks for a brief, or names a node that has none.
argument-hint: "[node id] — or nothing, for the first node that needs one"
---

<!-- Generated from plugins/skills/brief/SKILL.md by scripts/build-plugins.mjs. Edit the source, then run `pnpm plugins`. -->

> **These are tools, not commands.** Everything named in backticks below —
> `board`, `write_brief`, `approve` and the rest — is a tool of the `sober`
> MCP server SOBER installs into this host. Call it as a tool. Never reproduce
> one with `bash`, never read `.sober/` by hand, and never write a script that
> stands in for one: the board you would reconstruct is a guess, and a guess
> with real ids in it is worse than no answer. If a tool is not available, say
> so and stop — `sober --help` on the command line does all of it.

Read the board (`board`). Take $ARGUMENTS if it names a node, otherwise the first on **needs-brief**.

A node that is `held` or `blocked` does not get a brief yet, and saying so is the answer: a brief written against an unanswered decision is a guess the whole node inherits. Point at `/sober:decide` and stop.

Then, for that one node:

1. **Read before writing.** The node, what it depends on, the answers to the decisions it binds, and the code the work will touch. An approach that names no real file is a description of the ticket, not of the work.

2. **Write it** with `write_brief`. Two parts, both for this repository:
   - **The approach** — how the work gets done here, naming real files and real functions. Enough that an agent with the repository and this text asks no second question, because it will not get to.
   - **The acceptance list** — each entry a command that can actually be run in this repository, and what passing it proves. A criterion nobody can run is not a criterion, and "it works" is not what passing proves.

3. **Show it and approve it.** Put the approach and the criteria in front of the user, then ask a yes or a no with this host's own question tool. Call `approve` with `confirmed: true` only on an explicit yes; on a no, do nothing. You cannot approve on their behalf, and nothing runs without it. If they want it changed, rewrite with `write_brief` — a rewritten approach clears the approval it had, because the approved thing was the old approach.

Then say the node is `ready` and stop. Running it is `/sober:next`, and it is a separate decision: a run cuts a worktree and spends real money.

One node per invocation.
