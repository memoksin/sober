# 0009 — The MCP server and the first host plugin are v1 MUSTs

- Status: accepted
- Date: 2026-08-28

## Context

`SCOPE.md` listed the MCP server under SHOULD, on the test that "none of them is required for the loop to close once". `DESIGN.md` §5.1 described one agent call in detail — the dispatch, launched headless as `claude -p`. Three other agent calls were named but never designed: decomposition (§3.5), decision options (§2.6), and the brief's written section (§3.7). Each is a MUST — #10, #2, #3.

Designing those as a second subprocess path raised eight unanswered questions: what enforces JSON, what happens on a non-zero exit or a timeout, whether the call is cancellable, how many host sessions a wave consumes and who is told, whether it runs in the checkout or a worktree, and whether its output reaches the board.

The product this serves does not work that way. Planning happens **inside** a host session: the user states intent to their own agent, the agent proposes and drafts through SOBER's tools, and implementation-ready nodes are dispatched from the dashboard. Six of the eight questions disappear, because the human is present in a conversation they already opened. A seventh answer improves: a session already holds the repository in context, so its proposals are better than a cold subprocess's.

Three places in the documents already assumed this. `PR-09-03`: "The surfaces a human reads and writes are the dashboard **and the host plugins**." `DESIGN.md` §1.3, the same phrase. And `PR-00-08`: every CLI command "is usable headless by an agent in hosts **with no MCP server**" — a sentence that only makes sense if hosts with one have a better path.

## Decision

**MUST #12 — the MCP server.** An agent inside a host session reads the board, proposes nodes and edges, opens decisions, writes brief approaches, and reviews results, through SOBER's tools.

**MUST #13 — the Claude Code plugin.** The package installed into the host: the MCP server's configuration, three commands (`/sober-plan`, `/sober-next`, `/sober-decide`), and one skill that teaches the loop. An agent definition is not in v1 — the skill already carries the instructions.

**Hook enforcement stays v1.x.** Denying an agent spawn inside a host while a node is held remains a SHOULD, on §2.9's evidence: Codex silently ignores hook definitions until a human runs `/hooks`, and OpenCode has no elicitation for plugins.

The vocabulary is fixed at three terms, since two words were carrying three meanings:

| Term | What it is | Version |
| --- | --- | --- |
| **adapter** | SOBER launching a host headless, for a dispatch | v1 |
| **plugin** | the bundle installed into a host: MCP config, commands, skills | v1, Claude Code |
| **hook enforcement** | a plugin denying a spawn while a node is held | v1.x, host-dependent |

The advisory subprocess is not built. The dashboard does not generate proposals (ADR 0010); its empty state points at `/sober-plan`.

## Consequences

- `SCOPE.md` gains MUST #12 and #13. Its SHOULD list loses the MCP row, and "host plugins beyond the first" is corrected — it conflated adapters with plugins.
- `CHARTER.md`'s "the dashboard is the primary surface" needs the distinction it was missing: **intent is authored in a session, the board is managed in the dashboard.** The charter's objection was to watching runs in a terminal, not to planning in one.
- Phase 3 becomes `cli` + `mcp` + plugin. Its gate is better for it: the loop closes the way the product is actually used.
- MUST goes from 11 to 13, and roughly 18 requirements are added. Against that, the advisory subprocess and the dashboard's proposal surface are both dropped. ADR 0015 is what keeps the total tractable.
- The MCP server also covers review, so a session can be the only surface a user visits in M1. `PR-09-08`'s rule — every state-changing operation is available headless — now applies to three surfaces.

## Alternatives rejected

- **Build the advisory subprocess and keep MCP in SHOULD.** Two mechanisms for three MUSTs, the worse one primary, and a human watching a spinner for 30 to 90 seconds per call.
- **Call a model API directly for the advisory calls.** D28's reason holds: it makes SOBER an agent framework, owning the tool loop, file access and sandboxing.
