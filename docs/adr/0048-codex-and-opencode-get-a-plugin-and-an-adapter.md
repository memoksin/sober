# 0048 — Codex and OpenCode get a plugin and an adapter, and the skills get one source

- Status: accepted; superseded in part by [ADR 0057](0057-the-host-question-tool-asks-and-the-agent-relays-the-pick.md) — "no tool takes an answer"
- Date: 2026-09-07
- Moves: SCOPE SHOULD → MUST #16
- Refines: ADR 0009, ADR 0010, ADR 0046, ADR 0047, `DESIGN.md` §2.9, §5.1

## Context

`SCOPE.md` kept "plugins for hosts beyond Claude Code, and the dispatch adapters that go with them" in SHOULD, on the test that none of it is needed for the loop to close once. That test is still passed. Two facts changed underneath it.

**The first is that the abstraction was never built, only promised.** `host.ts` said it plainly: "deliberately not abstracted: Claude Code is the only host in v1, and the second one is what earns the interface." What that produced is one hard-coded invocation with the host's name nowhere in it — `-p`, `--output-format stream-json`, `--permission-mode bypassPermissions`, `--append-system-prompt` — plus a login probe that assumes `auth status --json`, plus a log renderer in `tail.ts` that reads one host's event names. Three files, three different assumptions, none of them labelled. A second host is the only thing that can show which of those are host facts and which are SOBER's.

**The second is that both candidate hosts moved.** `DESIGN.md` §2.9 carried two observations from v0: Codex silently ignores hook definitions, and OpenCode has no elicitation for plugins. Both are still true, and both were recorded when neither host had anywhere to put a skill. They do now. Codex 0.153 reads `.codex-plugin/plugin.json` with a `skills` path and a plugin-local `.mcp.json` — nearly the shape of the Claude Code plugin. OpenCode 1.18 reads `.opencode/skills/<name>/SKILL.md` and an `mcp` block in `opencode.json`. The half of "host-dependent" that blocked a plugin was the missing surface, not the missing hook, and the missing surface is gone.

Against that, the cost of waiting is a product whose one adapter cannot be told apart from its own dispatch code.

## Decision

**MUST #16 — Codex and OpenCode, plugin and adapter each.** Two hosts, not one and not three. One host done properly teaches what the abstraction is; the second is what proves it is not a rename of the first. Cursor stays in SHOULD: it is the one of the three whose headless invocation has no released shape to read flags off, and BUILD-PLAN §6 forbids writing one from memory.

Four things are settled with it.

**The adapter is a table, not a class.** `hosts.ts` holds one record per host: the probe that asks whether it can run, how its answer reads, the argv for one run, whether it can be attended, and how one of its events renders. `host.ts` keeps everything all three share — the spawn, the line splitting, how an exit is read. Everything that turned out to differ is data:

| | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| ready | `auth status --json` | `login status` | `providers list` |
| run | `-p <brief> …` | `exec --json …` | `run --format json …` |
| permissions | `--permission-mode bypassPermissions` | `--dangerously-bypass-approvals-and-sandbox` | `--auto` |
| system prompt | `--append-system-prompt` | none — in front of the brief | none — in front of the brief |
| attendable | yes | no | no |

Every row was read off the installed CLI and one real invocation at implementation time, never from memory (BUILD-PLAN §6). The recordings are in `docs/testing/v1x-4-other-hosts.tdd.md`.

**A host with no adapter is refused, not defaulted.** `dispatch.host` is a command line, so the adapter is found by looking for a known host in it — `npx codex` and `/opt/homebrew/bin/codex --model x` are both Codex. Anything else stops before the worktree, naming the three hosts SOBER has. Falling back to the Claude Code invocation would send `--permission-mode` to a CLI with no such flag; the price of the strictness is that a wrapper script has to be named after what it wraps, which the refusal says.

**A run log says which host wrote it by its own shape.** Each adapter recognises its events and returns nothing for the others, so `tail` needs no host argument and no call site changed. The property that buys: a run started under one host still renders after `dispatch.host` changes.

**The skills have one source and a build step.** `plugins/skills/` holds the prose with named slots; `plugins/hosts/<host>.json` holds what each host calls things; `scripts/build-plugins.mjs` writes the generated file into each package. The generated files are committed, because a plugin is installed by copying a directory and nobody runs a build to do that — and a test asserts they are current, because a generated file edited in place looks right until the next build silently reverts it.

The alternative was copying the prose per host and letting each drift on purpose. It was rejected on what drifts first: the "What never happens" list, which is the load-bearing paragraph in the whole plugin, and the one a human editing three copies stops re-reading by the third.

**Where a host cannot enforce or cannot ask, its plugin says so.** This is §2.9's rule, and this is the first release with somewhere to apply it. Neither new plugin ships a hook, so neither claims one: their loop skill says SOBER states the rule here and cannot enforce it, which makes keeping it the reader's. Neither host can be attended, so `dispatch` refuses an attended run there with a sentence rather than quietly downgrading it to a headless one somebody is watching.

**How a decision reaches the human is the host's own way of asking.** ADR 0010 rejected "letting the session's agent supply a decision's answer" and put the pick in elicitation. What survives of that rule is its reason — **the pick comes from the human, never from the agent** — and not its mechanism. To the person answering, an elicitation prompt and the host's own question control are the same act; the MCP capability is one implementation of it and not the definition. So the skills now say: put the question to the user through this host's own way of putting one on screen, and where the host has none, `decide` refuses rather than guessing and the agent stops, asks in the conversation, and waits. `sober decide <id> <option>` records what they say.

What does not change is every refusal around it: no tool takes an answer, one question per call, no batch, no default, and no treating an earlier remark as a reply. `ask.ts` is untouched — elicitation still runs wherever a host offers it, and it is now described as one way of asking rather than the only one.

## Consequences

- `SCOPE.md` gains MUST #16. Its SHOULD list keeps Cursor, keeps hook enforcement for the two new plugins, and gains attended dispatch beyond Claude Code — three things this ADR deliberately did not build.
- `DESIGN.md` §2.9 and §5.1 gain the host-by-host table and lose the sentence that said the second host is what earns the interface. It has been earned.
- `core` gains `hosts.ts`; `host.ts` shrinks to what every host shares and re-exports the constants that moved. No new public export, so the export ceiling does not move (ADR 0028).
- `packages/codex-plugin` and `packages/opencode-plugin` are new; `packages/claude-code-plugin/skills` becomes generated output. `.agents/plugins/marketplace.json` is the Codex marketplace, verified by installing from it with the real CLI.
- The fake host used by every dispatch test moves to `test/integration/hosts/claude.mjs` and gains two siblings. A fake that impersonates a host now has to say which one — the same rule a real wrapper script follows.
- **What is proven and what is not.** The tests dispatch to each new host end to end against a real repository, a real worktree and a real child process, with the host faked (ADR 0014) from recorded output. They do not prove that a live Codex or OpenCode session drives the loop correctly; that is a gate, and `docs/testing/v1x-4-other-hosts.tdd.md` says so rather than claiming what it did not run.

## Alternatives rejected

- **All three hosts at once.** Cursor's headless invocation cannot be read off an installed CLI here, so its adapter would be written from memory — which is the one thing BUILD-PLAN §6 forbids, and the reason every flag in this repository has a recording behind it.
- **Only the plugins, or only the adapters.** They are independent, and either half alone is a host you can plan in but not dispatch to, or dispatch to but not plan in. Neither closes the loop, which is the test `SCOPE.md` applies to everything.
- **Defaulting an unknown host to the Claude Code invocation.** Fails three minutes later as an unreadable exit code, on a machine where the user believed it was configured.
- **Passing the host into `tail` so a log knows how to render.** Five call sites, one more thing to thread, and wrong for a log written before `dispatch.host` last changed. The event already says what it is.
- **Copying the skills per host.** See above: the first thing to drift is the list that matters most.
- **Building attended mode for the new hosts out of `codex queue` and `opencode attach`.** Both exist and both are a second session protocol — a different feature wearing this one's name, and ADR 0046 already drew that line once for tool-permission prompts.
