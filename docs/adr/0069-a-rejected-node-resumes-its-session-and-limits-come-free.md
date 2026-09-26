# 0069 — A rejected node resumes its session, and limits come free

- **Status:** accepted
- **Date:** 2026-09-26
- **Refines:** DESIGN §6.4, ADR 0021, the `limit-detect` decision
- **Evidence:** `docs/RUN-COST-TODO.md` (M1, L1–L3, S1–S4)

## Context

- A retry after a rejection reused the worktree and the branch, but started a new
  host session. The agent paid again to learn the code it had just changed.
- To know whether an account had runway, SOBER sent a real model request per
  host. The Claude probe loaded ~26k tokens of context to read one event.
- oh-my-pi and similar tools solve both by talking to the providers with the
  subscription's OAuth token. Anthropic's terms forbid that outside its own
  clients, and OpenCode had to remove it. SOBER keeps to the official CLIs.

## Decision

- **The run record keeps the host's session** (`session`: Claude's `init`,
  Codex's `thread.started`, OpenCode's `sessionID`) and what the host said it
  spent (`usage`: turns, peak context, cost — Claude only).
- **A node with feedback resumes its last run's session**, when that run named
  one and ran on the same host CLI: `claude --resume`, `codex exec resume`,
  `opencode run --session`. The prompt is the feedback and the unchanged brief.
- **A large Claude session is compacted first.** Above 100k peak context, SOBER
  sends `/compact …` at `--effort low`, then resumes it. Measured over 26 retries,
  resuming without compaction would have cost 1.8× the fresh retries, because
  each turn re-reads the whole first attempt. At 110k and above, compaction pays
  for itself in the first retry turn; at 50–76k it takes 12–16 turns.
- **A session that cannot be resumed starts cold.** A compaction that fails, or a
  resume that fails before any tool call, falls back to a fresh session. That
  prompt carries the last attempt's final message under "What the last attempt
  reported", and the dispatch prompt now asks every agent to end with one.
- **Limits come from the runs.** Every Claude run's own `rate_limit_event` is
  written to `hosts.json` with window utilization and reset times. Each host
  entry keeps its own time, so one host's
  fresh answer does not renew another's. The Claude probe runs with nothing
  loaded (~400 tokens). Codex is asked through `codex app-server`
  (`account/rateLimits/read`), which costs no model call; if that fails, the old
  `exec` probe runs. At `dispatch.limitSoft` (default 0.9), Jev prefers a host
  with more runway; `sober models` shows the known windows.

## Consequences

- The retry's cost depends on the compaction: one summarising request over the
  old session, then turns that start from a short summary.
- If the retry is more than 5 minutes after the first run, the prompt cache is
  cold, and the compacted context is written again. That is small after
  compaction.
- The Codex app-server protocol is marked experimental. The parse is covered by
  a test with the shape recorded from 0.156.1.
- `claude -p --resume` on sessions over 100k tokens and hours old (109k, 164k)
  resumed with no prompt; only the interactive client asks there. OpenCode's
  `run --format json` stamps `sessionID` at the top of every event.
