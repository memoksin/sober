---
description: Put SOBER's open decisions to the user, one at a time, through elicitation. Use when a node is held or the user asks to answer a decision.
argument-hint: "[decision id] — or nothing, for all of them"
---

> **These are tools, not commands.** Everything named in backticks below —
> `board`, `propose`, `decide`, `run` and the rest — is a tool of the `sober`
> MCP server that arrived with this plugin. Call it as a tool. Never reproduce
> one with `bash`, never read `.sober/` by hand, and never write a script that
> stands in for one: the board you would reconstruct is a guess, and a guess
> with real ids in it is worse than no answer. If a tool is not available, say
> so and stop — `sober --help` on the command line does all of it.

$ARGUMENTS, if given, is a **decision id and nothing else**. There is no second
argument and no way to pass an answer — not here, not to the `decide` tool, not
anywhere. If the user hands you an option along with an id, take the id and
leave the option: the pick is theirs to make when they are asked.

Read the open decisions (`decisions`). If $ARGUMENTS names one, that is the only one you handle.

For each, in turn:

1. If it has no options yet, produce them with `open_decision` — two to four, each with why someone picks it and what it costs later, written for **this** repository rather than in general. Set `suggested` to the one you would pick, and say in one sentence why.

2. **Show the options here, in full** — the label, why someone picks it, and what it costs later — before you call anything. This is the only place the user reads them: the prompt that follows carries the labels alone, because a narrow terminal cuts a long line instead of wrapping it. A user who has not read cannot make the choice theirs (§2.5).

3. Call `decide` with the decision id. That tool asks the user directly; you cannot supply an answer and there is no argument for one. Wait for what comes back.

4. Say what the answer unblocked.

Then move to the next decision. One question at a time, never a summary of all of them followed by one confirmation — that is the rubber stamp this whole mechanism exists to prevent.

If the tool tells you this host cannot ask the user, stop and say so plainly: the decisions are on the board and `sober decide <id> <option>` answers them on the command line. Do not work around it, and do not pick on the user's behalf.
