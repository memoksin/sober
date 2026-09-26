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

Read the board (`board`). Take the id the user gave if it names a node, otherwise the first on **needs-brief**.

A node that is `held` or `blocked` does not get a brief yet, and saying so is the answer: a brief written against an unanswered decision is a guess the whole node inherits. Point at `the **decide** skill` and stop.

Then, for that one node:

1. **Read before writing.** The node, what it depends on, the answers to the decisions it binds, and the code the work will touch. An approach that names no real file is a description of the ticket, not of the work.

2. **Write it** with `write_brief`. Three parts, all for this repository:
   - **The approach** — how the work gets done here, naming real files and real functions. Enough that an agent with the repository and this text asks no second question, because it will not get to. Name inside it the files and line ranges you already found, e.g. "Where: packages/core/src/x.ts:120–180" — the dispatched agent should not have to search for what you already located.
   - **The complexity** — score the node 1–10 for how hard it is for one agent in one run in this repository: files touched, how much has to be understood first, how easy it is to check. Say in one sentence of the approach why that number.
   - **The acceptance list** — each entry a command that can actually be run in this repository, and what passing it proves. A criterion nobody can run is not a criterion, and "it works" is not what passing proves.
   - **`plain`** — the same brief in everyday words, for someone with no repository knowledge: what changes, why, how success is checked, and any meaningful risk ("none" if there is none).

3. **Approve it.** `write_brief` returns a block rendered from `plain`. Paste that block into the conversation as it is — do not summarize or rewrite it — then ask a yes or a no about it: Ask with `request_user_input`, this host's own question tool — one question, a yes and a no. It is there in the interactive Default and Plan modes, never under `codex exec`. When it is not listed, ask in the conversation and wait for a reply. Codex's own prompt tells the model never to use `request_user_input` for a permission request, so the yes may come in the chat instead, even in Default mode; that is fine, the rule is the same: a yes in the chat is a yes, silence is not. Never answer on their behalf. Say whether yes also starts the node when it becomes ready, according to the `queue` argument or the board's `dispatch.queueByDefault`. Call `approve` with `confirmed: true` only on an explicit yes; on a no, do nothing. If they want it changed, rewrite with `write_brief` — a rewritten approach clears the approval it had, because the approved thing was the old approach.

Then say the node is `ready` and stop. Running it is `the **next** skill`, and it is a separate decision: a run cuts a worktree and spends real money.

One node per invocation.
