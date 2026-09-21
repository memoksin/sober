# 0062 — SOBER reaches an OpenAI-compatible endpoint itself

- **Status:** accepted
- **Date:** 2026-09-21
- **Refines:** DESIGN §5.1, [ADR 0058](0058-a-tier-names-its-host-and-model.md), [ADR 0061](0061-a-model-is-named-and-jev-picks-among-them.md)

## Context

DESIGN §5.1 says SOBER "never asks for an API key", and the reason given is
that "calling a model API directly … makes SOBER an agent framework — owning
the tool loop, file access, and sandboxing. That is a different product."
ADR 0061 restates the same ground: "A provider is a command line … SOBER
gains no API client and no tool loop."

That held until every extra model a board wants past the four host CLIs turned
out to be an OpenRouter one, and OpenCode is the only host that reaches
OpenRouter today. OpenCode's own readiness probe — `providers list` — fails
when SOBER runs it from inside the MCP server: `could not report its
authentication status`. A model behind that probe cannot start a run at all,
regardless of what `dispatch.models` names.

## Decision

**`openrouter` becomes a fifth host**, served by SOBER's own loop against the
OpenAI chat-completions format. OpenRouter is the default target; a setting
on the `dispatch.models` entry may point the same loop at any other
OpenAI-compatible base URL. The four existing host CLIs — Claude Code, Codex,
OpenCode, Cursor — stay the only road to everything else: Claude, Codex's own
models, Cursor's, and OpenCode's other providers.

**The loop runs as a `sober agent` subprocess**, spawned by the adapter table
the same way the four CLIs already are — decision
`where-does-sober-s-own-tool-loop-run-in-i1nr`, answered **subprocess**. It
prints one JSON event per line, so `startAgent`, `checkHost`, `stop` (by
pid), `sober logs` and the run panel all work unchanged; `openrouter` is one
more row in `hosts.ts`, not a second code path. The alternative, running the
loop in-process inside `core`, was rejected: it means two launch paths in
`host.ts` — one that spawns, one that calls a function — and a hung `fetch`
inside the MCP server's own process hangs the dispatcher instead of a
subprocess that `stop` can kill.

**On 429 and 5xx the loop retries a bounded number of times with backoff,
and says so in the log**; anything else fails at once with the status —
decision `when-the-endpoint-refuses-mid-run-a-429-8q5u`, answered
**bounded-retry** (three tries). Free OpenRouter models rate-limit often and
briefly, and a short backoff turns most of those into a finished run instead
of a failed one; a 400, a 401 or a context-length error is not transient and
fails immediately with the status in the reason. `fail-fast` lost because it
throws away runs that would have finished on the second try. `next-model`
lost for two reasons: it leaks a model choice out of Jev, which ADR 0061 gave
sole ownership of that pick, and it overlaps `backup-8erx`'s job of choosing
a fallback host — this decision is only about one endpoint's own retries. The
log states the wait so a silent backoff window does not look like a stuck
run (the `pcsz` node's rule).

**The key is `OPENROUTER_API_KEY`**, read from `.sober/.env` the way
`JEV_API_KEY` already is (`packages/core/src/env.ts`) — one variable,
regardless of which base URL the entry points the loop at. A per-base-URL
name (`OPENAI_API_KEY`-style) is out of scope: one endpoint's worth of
config is what this node needs, and a second variable can be added the day a
second base URL actually ships.

## Consequences

- SOBER now owns a tool loop and the four tools it exposes to a run. §5.1's
  sentence — "that is a different product" — still holds for the four host
  CLIs, which is where the sandboxing, file access and skills actually live.
  The `openrouter` loop is not that product's replacement: it has no sandbox
  beyond the node's own worktree, no MCP, and no skills — it is a chat loop
  with tool calls, scoped to what a coding task needs, not a general agent
  framework.
- The `sober` binary must be on the PATH the MCP server sees for `sober
  agent` to spawn — the same requirement `sober mcp` already has, now also on
  the run path.
- `hosts.ts` gains one row; `checkHost` for `openrouter` is "is
  `OPENROUTER_API_KEY` set", not a CLI probe — there is no login state to
  fail on the way OpenCode's does.

## Alternatives rejected

- **Keep OpenCode and fix its probe.** The probe is not the only failure: a
  run's `--model openrouter/…` still depends on OpenCode's own provider
  config, which is a second thing to get right per machine. Fixing the probe
  does not fix that.
- **Cline as the road to OpenRouter.** A third CLI in the way of what is,
  underneath, one HTTP endpoint and one API key — more to install and log
  into for no more reach than the loop already gives.
