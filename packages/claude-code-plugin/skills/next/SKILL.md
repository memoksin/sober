---
description: Take the next ready SOBER node from brief to merged — write it, get it approved, run it, review it. Use when the user asks what is next or to start work on the board.
argument-hint: "[node id] — or nothing, to take the first that is ready"
---

<!-- Generated from plugins/skills/next/SKILL.md by scripts/build-plugins.mjs. Edit the source, then run `pnpm plugins`. -->

> **These are tools, not commands.** Everything named in backticks below —
> `board`, `propose`, `decide`, `run` and the rest — is a tool of the `sober`
> MCP server SOBER installs into this host. Call it as a tool. Never reproduce
> one with `bash`, never read `.sober/` by hand, and never write a script that
> stands in for one: the board you would reconstruct is a guess, and a guess
> with real ids in it is worse than no answer. If a tool is not available, say
> so and stop — `sober --help` on the command line does all of it.

Read the board (`board`). Pick the node: $ARGUMENTS if it names one, otherwise the first that is **ready**, or the first that is **needs-brief** if none is ready yet.

If nothing can move, say what everything is waiting on and stop. A node held by a decision needs `/sober:decide`, not a workaround.

Then, for that one node:

1. **Brief.** `/sober:brief` is this step on its own, for when the brief is all that is wanted. Here: read the node and the repository, and write the approach with `write_brief`: how you would do it, in this codebase, naming real files. With it, the acceptance list — each entry a command that can actually be run here and what passing it proves. A criterion nobody can run is not a criterion.

2. **Approve.** Show the user the approach and the criteria, then ask a yes or a no with this host's own question tool. Call `approve` with `confirmed: true` only on an explicit yes; on a no, do nothing. You cannot approve on their behalf, and nothing runs without it.

3. **Run.** `run` cuts the node's worktree, prepares it and works. It blocks for as long as the work takes and streams what the agent is doing. If it fails, read `logs` and say what happened — do not silently start it again.

4. **Review.** `review` gives you the scan, then the acceptance criteria, then the files. Read the findings first. Ask for the diff only if the findings or the criteria give you a reason to; reading every line to find the problem is doing the scan's job by hand.

5. **Accept or reject.** Tell the user what you found and what you would do. Then ask a yes or a no with this host's own question tool. Call `accept` with `confirmed: true` only on an explicit yes — it merges. On a no, merge nothing and offer `reject`, with what was wrong in the words the next run should read. Rejecting deletes nothing.

Then say what moved off `blocked`, and stop. One node per invocation.
