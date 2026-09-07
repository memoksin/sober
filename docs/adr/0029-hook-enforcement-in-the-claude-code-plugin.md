# 0029 — Hook enforcement is a MUST in the Claude Code plugin

- Status: accepted
- Date: 2026-09-07
- Moves: SCOPE SHOULD → MUST #14
- Refines: ADR 0003, ADR 0006, ADR 0009, `DESIGN.md` §2.9

## Context

ADR 0003 named the decision SOBER's one hard block, and ADR 0006 put the hold on the binding rather than on a flagged node, so that answering one question unblocks everything it shapes. `core` honours that: `statusOf` derives `held`, and no surface dispatches a held node — not the CLI, not the dashboard, not the MCP server's `run`.

ADR 0009 then made the MCP server a MUST, and with it opened a hole in the block it was built to serve. Planning now happens **inside a host session**, where the user has their own agent with its own file tools. Nothing about a held node stops a person saying "just build it": SOBER refuses to dispatch, and the agent writes the twenty files anyway. Outside the session the decision is enforced; inside it, it is advice.

`SCOPE.md` kept hook enforcement in SHOULD on one fact: it is host-dependent. Codex hashes hook definitions and silently ignores them until a human runs `/hooks`, and OpenCode has no elicitation for plugins. That fact is still true — and it is a fact about Codex and OpenCode. **Claude Code honours hook definitions shipped in a plugin, and Claude Code is the host v1 ships a plugin for.** The reason for the SHOULD does not apply to the only plugin that exists.

Against that stands what the hole costs. Every other MUST assumes the block holds. A decision answered after the work is written is not a decision; it is a ratification, which is the rubber stamp §2.5 exists to prevent.

## Decision

**MUST #14 — hook enforcement in the Claude Code plugin.** `hooks/hooks.json` declares two hooks, both calling `sober`, the binary `.mcp.json` already names:

- `PreToolUse` on `Task` → `sober hook spawn`
- `SessionStart` → `sober hook session`

Four things are settled with it.

**What is denied: a spawn that names a held node.** The guard reads the spawn's `description` and `prompt`, and denies if either names, as a whole token, a node the board holds. The denial gives the node, the unanswered decisions, what each asks, and both ways to answer — `/sober-decide` and `sober decide <id> <option>`.

The two alternatives were weighed and rejected. *Deny every spawn while anything is held* is a product that stops you working: one held node and the session cannot write a brief for an unrelated one. *Deny writes to the held node's declared globs* needs a prediction §3.1 does not make — `files` is a scan signal, not a contract, and a spawn's writes are not knowable before it runs. The id is the only handle a host actually gives us, and ADR 0020's shape — a slug plus four characters — makes it a good one: distinctive enough to look for, specific enough that finding one means the agent is being aimed at that node.

**The guard derives nothing.** `sober hook` is a CLI subcommand, not a script in the plugin, so it calls `statusOf` — the same function the board, the CLI and the MCP server call. A second implementation of `held` would drift from the first, and then be wrong in the one place being wrong is expensive.

**There is no override.** No flag, no config key, no `ask` instead of `deny`. The way through is answering the decision. A switch would put the one hard block behind a setting, and that setting would be turned off exactly once — the first time it was inconvenient — after which nothing would say it was off. The risk taken in exchange is real and named: a guard that is wrong gets the plugin uninstalled. It is the smaller risk, because a wrong denial is loud and an absent block is silent.

**A guard that cannot run says so.** Three cases, and they are not the same:

- **No board in this repository.** Silence. There is nothing to enforce, and a session in an unrelated checkout must not hear from SOBER.
- **A file on the board cannot be read.** A broken node file falls off the board, so what it held was never weighed. The verdict carries a `systemMessage` naming the file and saying enforcement did not run over it. This is ADR 0011's rule for the scan, applied unchanged: never report clean what did not run.
- **The hook is not installed at all.** Nothing can be said from inside a guard that is not there, which is why `SessionStart` exists — the installed guard announces itself, so its absence is visible as the missing line.

**Hooks for other hosts stay in SHOULD**, with the plugins that would carry them. A plugin for a host that cannot deny must say so on install rather than implying a guard it does not have.

## Consequences

- `SCOPE.md` gains MUST #14 and its SHOULD row is rewritten: what remains host-dependent is hook enforcement in the *other* plugins, not the concept.
- `DESIGN.md` §2.9 moves hook enforcement to v1 for Claude Code and documents the shape. ADR 0009's table is left as written — it recorded what was true then.
- `packages/cli` gains `hook.ts` and one subcommand. `core` gains nothing, which is the point: the export ceiling does not move (ADR 0028).
- The loop skill tells the agent the guard exists and that rephrasing past it is not a route.
- **What is proven and what is not.** The tests assert the contract: a real board, the built binary, a real hook payload in on stdin, the verdict out on stdout — including that a board it cannot read is not a pass. They do not assert that Claude Code obeys the verdict. That is the host's code, nothing in this repository can reach it, and `docs/testing/hook-enforcement.tdd.md` says so rather than letting the evidence report claim more than it proved.

## Alternatives rejected

- **Keep it in SHOULD until every host can do it.** The block is v1's whole argument, and it currently has a hole in the surface v1 tells people to plan in. Waiting for Codex to change makes the product wrong now to keep a table tidy.
- **A `hooks.spawn: "off"` key in `config.jsonc`.** Honest and reviewable, and still an off switch on the one thing nothing routes around. The escape hatch that is documented is the one that gets used.
- **Ship the hook in the plugin as its own script.** One fewer subcommand, and a second place that decides what `held` means. ADR 0006 exists because that answer has to come from one place.
