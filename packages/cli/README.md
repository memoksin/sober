<p align="center"><img src="https://raw.githubusercontent.com/memoksin/sober/main/docs/assets/sober_dark.png" width="120" alt="SOBER logo" /></p>

# @besober/cli

**SOBER plans work as a graph, then dispatches agents.**

You describe what you want built. An agent proposes the graph — the nodes, what
depends on what, and the architectural questions each node hangs on. You answer
the questions. Agents write the code, one worktree each, in parallel. You review
what comes back and land it.

You finish knowing why every decision in the project was made.

## Install

```sh
npm i -g @besober/cli
```

That is the whole installation — no post-install step, nothing compiled, no
runtime to fetch. Node 22 or newer.

```sh
cd your-repo
sober init
sober --help
```

`init` creates `.sober/`, writes a `config.jsonc` with every setting at its
default and a comment explaining each, and cuts the orphan board branch
(`sober-graph`).

## The loop

Always in this order. Nothing skips a step.

```
plan → decide → brief → approve → run → review → accept
```

Status is derived, never set: a node is `held` while a decision it binds is
unanswered, `blocked` while a dependency is not accepted, then `needs-brief`,
`ready`, `running`, `in-review`, `done`.

## The one hard block

A **decision** is a question whose answer changes the shape of more than one
node — `state`, `module-boundaries`, `data-flow`, `error-handling`, and no fifth
category. Every node bound by an unanswered decision is held, and nothing routes
around it.

Each option carries its reason *and what it costs later*. The choice is always
the human's; no tool takes one on your behalf.

## Commands

```
Start here   init · status
Decide       decisions · decide · edit · bind
Prepare      brief · approve
Build        run · stop · logs · say
Review       review · audit · accept · reject
Share        sync · resolve
Team         contributors · assign · claim · release · distribute
Tidy         dismiss · reopen · open · archive
Surfaces     dashboard · mcp · hook
```

`sober --help` prints all of them with a line each.

## Where you work

Planning happens **in your own agent session**, through the SOBER plugin — you
are already there, with the repository in context. `sober dashboard` serves the
board in a browser. Every command here also works headless, for hosts that have
no plugin.

Plugins ship for Claude Code, Cursor, Codex and OpenCode. See the
[repository](https://github.com/memoksin/sober#hosts).

## When not to use it

Below roughly **five nodes**, don't. Planning that cannot pay for itself is worse
than no planning.

---

Docs, ADRs and the source:
[github.com/memoksin/sober](https://github.com/memoksin/sober)
