# 0034 — The operator's machine is not on the board

- Status: accepted
- Date: 2026-09-06
- Answers: M2 gate finding 1 (`docs/M2-GATE.md`), and the question it raised —
  whether SOBER should grow a global configuration of its own

## Context

The M2 gate dispatched five agents. Two finished with `✓ finished`, an empty
branch, no pull request, and their work sitting staged in a worktree. The run
log says why: it carried the operator's own `~/.claude/` tree, and one rule in
it said "never run `git commit` without asking for confirmation first". The
agent stopped to ask a question no human was there to answer. A third dispatch
replied in the operator's preferred language.

`--permission-mode bypassPermissions` was already being passed and did not
reach any of it. The agent was never blocked; it was **instructed**.

That splits the sources of an agent's instructions into three, and they are not
the same kind of thing:

- **The repository** — `CLAUDE.md` or `AGENTS.md`, `.sober/config.jsonc`, and
  the brief. Committed, reviewed in a pull request, identical for everyone who
  clones. The worktree is inside the repository, so the host already discovers
  these without SOBER doing anything.
- **The operator's machine** — `~/.claude/**`. Invisible to the team,
  unreviewable, and different on every machine.
- **A global SOBER configuration** — which does not exist.

M2 is the milestone where the board travels. A board that produces one result
on Alice's machine and another on Bob's is the failure that milestone exists to
prevent, and it does not announce itself: both runs say `finished`.

## Decision

**The repository is the only place an instruction may come from.** The project's
`CLAUDE.md` / `AGENTS.md`, `.sober/config.jsonc`, and the brief. All three
travel with the work and are read by everyone; nothing else is a source.

**SOBER will not grow a global, per-machine configuration.** ADR 0019 already
says configuration is read from the base branch. This extends the same rule to
the agent's instructions, for the same reason: a setting that lives on one
machine is, in a team tool, a defect class rather than a feature. A per-node
instruction has a home already — the brief, which a human approves and a
reviewer reads.

**The dispatched agent is told, in its own system prompt, that nobody is
reading.** `NO_HUMAN` in `packages/core/src/host.ts`, passed as
`--append-system-prompt`. It answers the instruction where instructions live,
which is the level the failure was on.

**What this does not close is named rather than implied.** The operator's
`CLAUDE.md` still reaches the agent; only its "ask before acting" half is
answered. Style, language and tool preferences still leak, and the same board
can still produce differently-shaped work on two machines. The candidate lever
is `--setting-sources project,local`, which drops the user source. It is not
taken here because it is unverified whether it also cuts `~/.claude/CLAUDE.md`
discovery or only `settings.json`, and the difference is the whole of it.

## Consequences

- Two clones of one board can still produce work that reads differently. That
  is now a known gap with a named first move, not a surprise mid-drive.
- The next drive that loses something to this leak is what earns the
  verification of `--setting-sources`. Until then the cost is cosmetic: the
  work lands, it merely sounds like whoever dispatched it.
- No `~/.sober/` directory, ever. A request for one is a request to make a
  board behave differently per machine, and the answer is a project setting or
  a brief.
- When a second host earns the adapter interface (DESIGN §5.1), the file it
  reads is `AGENTS.md`, not `CLAUDE.md`. Nothing has to change now; v1 has one
  host and it reads both.

## Alternatives rejected

- **A global SOBER configuration.** It would hold the same per-machine state
  under a name SOBER controls, and contradict ADR 0019 while doing it. The
  problem is not where the machine's opinions are written down; it is that they
  reach a shared board at all.
- **`--safe-mode`.** It disables every customization — `CLAUDE.md`, skills,
  plugins, hooks, MCP — which takes the project's instructions out with the
  operator's. The project's `CLAUDE.md` is exactly what the agent should be
  following.
- **Materialising the project's instructions into the worktree.** The brief is
  already handed over as the prompt for this reason (DESIGN §3.7): a file
  written into the worktree is a diff the scan reports on every dispatch.
- **Doing nothing.** Two of five runs is not a tail case, and the failure is
  silent — the node moves to `in-review` with an empty branch behind it.
