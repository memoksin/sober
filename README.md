<p align="center"><img src="docs/assets/sober_dark.png" width="120" alt="SOBER logo" /></p>

# BE SOBER!

**SOBER plans work as a graph, then dispatches agents.**

You describe what you want built. An agent proposes the graph — the nodes, what
depends on what, and the architectural questions each node hangs on. You answer
the questions. Agents write the code, one worktree each, in parallel. You review
what comes back and land it.

You finish knowing why every decision in the project was made. That is the point
of the thing.

## Three jobs at once

- **Orchestration.** A graph of nodes coordinates a small team — human and agent
  — working one project in parallel. Who owns what, what is blocked, what can
  start now.
- **Automation.** Implementation goes to parallel agents. The human thinks, the
  agent types.
- **Education.** Every option carries its reason *and what it costs later*. You
  do not end up with a shipped repo you cannot explain.

What SOBER is **not**: accelerated vibe coding. Speed is a side effect. A node
that ships faster while you understand less is a failure.

## Install

```sh
npm i -g @besober/cli
```

That is the whole installation — no post-install step, nothing compiled, no
runtime to fetch. Node 22 or newer.

Then, in a git repository:

```sh
sober init
```

This creates `.sober/`, writes a `config.jsonc` with every setting at its
default and a comment explaining each, and cuts the orphan board branch
(`sober-graph`).

## The loop

Always in this order. Nothing skips a step.

```
plan → decide → brief → approve → run → review → accept
```

| Step | What happens | Who owns it |
| --- | --- | --- |
| **plan** | An agent proposes nodes, edges and decisions from your intent | agent drafts, you accept |
| **decide** | Two to four options, each with its reason and its later cost | **you** |
| **brief** | The approach in this codebase, plus an acceptance list of runnable commands | agent drafts |
| **approve** | Nothing runs without it | **you** |
| **run** | The node gets its own worktree and branch; the agent gets the brief | agent |
| **review** | A scan over the added lines, the criteria, then the diff | agent reads, you judge |
| **accept** | Merge, and the node is done | **you** |

**Status is derived, never set.** A node is `held` while a decision it binds is
unanswered, `blocked` while a dependency is not accepted, `needs-brief`,
`ready`, `running`, `in-review`, `done`. There is no field to forget.

## The one hard block

A **decision** is a question whose answer changes the shape of more than one
node. Four categories and no fifth: `state`, `module-boundaries`, `data-flow`,
`error-handling`.

Every node bound by an unanswered decision is held, and nothing routes around
it. The alternative is an agent guessing at an architectural choice and twenty
files inheriting the guess.

It is SOBER's **one** hard block. Everything else is advisory — one hard block is
enforceable and five get routed around.

## Where you work

**Planning happens in your own agent session**, through the SOBER plugin. You are
already there, with the repository in context.

**The board lives on a screen.** `sober dashboard` serves the graph in a browser:
a force-directed canvas, a detail panel, every state-changing operation except
install and init.

**The CLI does all of it headless**, for hosts with no plugin. `sober --help`.

## Hosts

| Host | Plugin | Decisions in session | Attended run |
| --- | --- | --- | --- |
| Claude Code | [`packages/claude-code-plugin`](packages/claude-code-plugin) | yes | yes |
| Cursor | [`packages/cursor-plugin`](packages/cursor-plugin/README.md) | yes | no |
| Codex | [`packages/codex-plugin`](packages/codex-plugin/README.md) | no | no |
| OpenCode | [`packages/opencode-plugin`](packages/opencode-plugin/README.md) | no | no |

Claude Code is the only host whose plugin can *enforce* the block from inside a
session, with a hook that denies a spawn onto a held node. Everywhere SOBER owns
the code path — CLI, dashboard, MCP server — the block is the same on every
host.

## When not to use it

Below roughly **five nodes**, don't. Planning that cannot pay for itself is worse
than no planning. Open the editor.

## Docs

| | |
| --- | --- |
| [`docs/CHARTER.md`](docs/CHARTER.md) | what SOBER is and is not |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | every requirement, with its ID |
| [`docs/DESIGN.md`](docs/DESIGN.md) | how it is built |
| [`docs/SCOPE.md`](docs/SCOPE.md) | what is in v1 and what is not |
| [`docs/adr/`](docs/adr) | every decision taken while building it |

## Development

```sh
pnpm install
pnpm build        # turbo, all packages
pnpm test         # vitest
pnpm lint         # biome + secretlint
pnpm typecheck
pnpm plugins      # regenerate the per-host plugins from plugins/skills
```

Skills under `packages/*-plugin/skills/` are **generated** from
`plugins/skills/`. Edit the source and run `pnpm plugins`.
