---
description: Put SOBER's open decisions to the user, one at a time. Use when a node is held or the user asks to answer a decision.
argument-hint: "[decision id] — or nothing, for all of them"
---

<!-- Generated from plugins/skills/decide/SKILL.md by scripts/build-plugins.mjs. Edit the source, then run `pnpm plugins`. -->

> **These are tools, not commands.** Everything named in backticks below —
> `board`, `propose`, `decide`, `run` and the rest — is a tool of the `sober`
> MCP server SOBER installs into this host. Call it as a tool. Never reproduce
> one with `bash`, never read `.sober/` by hand, and never write a script that
> stands in for one: the board you would reconstruct is a guess, and a guess
> with real ids in it is worse than no answer. If a tool is not available, say
> so and stop — `sober --help` on the command line does all of it.

What the user gave you, if anything, is a **decision id and nothing else**. There is no second
argument and no way to pass an answer — not here, not to the `decide` tool, not
anywhere. If the user hands you an option along with an id, take the id and
leave the option: the pick is theirs to make when they are asked.

Read the open decisions (`decisions`). If the id the user gave names one, that is the only one you handle.

For each, in turn:

1. If it has no options yet, produce them with `open_decision` — two to four, each with why someone picks it and what it costs later, written for **this** repository rather than in general. Set `suggested` to the one you would pick, and say in one sentence why.

2. **Show the options here, in full** — the label, why someone picks it, and what it costs later — before you call anything. This is the only place the user reads them: the prompt that follows carries the labels alone, because a narrow terminal cuts a long line instead of wrapping it. A user who has not read cannot make the choice theirs (§2.5).

3. Call `decide` with the decision id. That tool asks the user directly; you cannot supply an answer and there is no argument for one. Wait for what comes back.

4. Say what the answer unblocked.

Then move to the next decision. One question at a time, never a summary of all of them followed by one confirmation — that is the rubber stamp this whole mechanism exists to prevent.

The question reaches them through this host's own way of putting one on screen, and `decide` is what opens it. If this host cannot ask, `decide` says so rather than guessing — and then you stop, put the one question to the user in this conversation yourself, and wait. `sober decide <id> <option>` on the command line is what records what they say. Never answer on their behalf, and never treat a reply you did not get as one.
