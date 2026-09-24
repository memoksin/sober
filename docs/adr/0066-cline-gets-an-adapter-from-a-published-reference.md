# 0066 — Cline gets an adapter from a published reference

- **Status:** accepted
- **Date:** 2026-09-24
- **Refines:** DESIGN §5.1, §2.9, [ADR 0048](0048-codex-and-opencode-get-a-plugin-and-an-adapter.md)

## Context

Cline shipped a CLI (npm `cline`) with a headless mode: `--json`, `--auto-approve`, a `--system` flag, and NDJSON output. BUILD-PLAN §6's rule for a new adapter is to read the invocation off the real thing — an installed CLI or, absent one, its published reference — never from memory. There is no `cline` binary installed in this environment, so this adapter is built the way Cursor's was (ADR 0048): from
https://docs.cline.bot/cli/cli-reference and https://docs.cline.bot/usage/cli-overview (both fetched 2026-09-24), cross-checked against the upstream `apps/cli` README on GitHub. The recordings are in `docs/testing/v1x-4-other-hosts.tdd.md`'s addendum.

Two things surfaced while reading it that the node asked to be resolved rather than guessed past:

1. The two documents disagree on the event envelope. The dedicated CLI reference shows a complete, flat worked example: `{"type": "say", "text": "…", "ts": …, "say": "text"}`. The upstream README instead pipes output through `jq 'select(.type == "agent_event" and .event.text)'`, which implies a wrapped shape, `{type: "agent_event", event: {...}}`. The jq line is a filter fragment inside a usage example, not a shown event, while the reference's example is complete and is the document `docs/testing/` names as the citation source. **The flat shape is what is implemented.**
2. Every other adapter's `probe`/`loggedIn` pair reads a command the reference documents as answering "is this CLI signed in" without starting a task: Claude Code's `auth status --json`, Codex's `login status`, OpenCode's `providers list`, Cursor's `status`. Cline's reference documents no such command. `auth` ("Authenticate a provider and configure what model is used") and `config` ("Show current configuration") are both described as interactive, with no `--json` shown for either; `doctor`'s output shape is undocumented; and `--version`/`version` proves the binary runs, not that it is logged in — the node's brief says this explicitly, and the reference gives no reason to disagree.

## Decision

**`cline` becomes a sixth adapter**, alongside Claude Code, Codex, OpenCode, Cursor and OpenRouter — headless, one-shot, not attendable.

**Argv:** `--json --auto-approve true <brief>`, where `<brief>` is `NO_HUMAN` in front of the node's prompt, the same shape as Codex, OpenCode and Cursor. The reference documents `-s, --system <system-prompt>` as an *override* of Cline's own default system prompt, not an addition to it — passing `NO_HUMAN` there would erase whatever Cline's default prompt does, in exchange for a flag placement that is not what the other three hosts do for the same reason (no system-prompt flag that adds rather than replaces). `--auto-approve true` is passed explicitly rather than relied on as a default, since the reference notes the default flips to `false` under `--acp`, which this adapter does not use.

**`probe: ['version']`, and `loggedIn` always answers `null`.** This is the prerequisite the Context section found: no documented command reports sign-in state without a task and without a prompt. Faking readiness off the fact that `cline version` printed something would tell a dispatcher a host is ready when nobody has verified anything about its account — the exact failure §2.8's "not knowing is not the same as being fine" rule exists to catch. Instead, `checkHost` reports "cline reported an authentication status SOBER cannot read" on every run, which is honest rather than useful: **dispatching a node to Cline through SOBER cannot pass preflight until the published CLI documents a non-interactive way to read sign-in state.** `probe` still runs `version`, so a Cline that is not installed at all is told apart with its own sentence ("is not installed, or is not on this PATH"), the same as every other host.

**`line` renders only the shape the reference shows worked in full**: `{type: "say"|"ask", text, ts, partial}`. A complete (non-`partial`) line becomes a `text` line, with `ts` converted to an ISO timestamp — Cline is the only host whose stream carries one. No `tool` or `result` mapping is invented: the reference names no subtype other than `"text"` for `say`/`ask`, and no event for the end of a run — like OpenCode, the outcome is read from how the process exited, not from a line in the stream.

**No entry in `packages/core/src/models.ts`.** The reference documents no command that lists Cline's models in a form a script can read — nothing like Codex's `~/.codex/models_cache.json` or OpenRouter's `/api/v1/models`. `sober models` is unchanged.

## Consequences

- Cline is a real row in `ADAPTERS`, refused by name like every unknown host, tested for argv shape and line rendering the same as the other five (`packages/core/src/hosts.test.ts`).
- Cline can never actually run a node through SOBER today — `checkHost` refuses it unconditionally, real CLI or fake. This is a documented prerequisite, not a bug: the day the published CLI adds a non-interactive auth check, only `cline.probe`/`cline.loggedIn` need to change, and everything downstream (argv, line rendering, the adapter's place in `ADAPTERS`) is already correct and already tested against the reference.
- `test/integration/other-hosts.test.ts` does not add Cline to the loop that dispatches a node end to end and expects it to finish — that loop needs a login that can be toggled, and Cline has none to toggle. It gets its own two tests instead: the preflight refusal, and that a dispatch (headless or attended) never reaches a worktree.
- Nobody using Cline today gets an adapter that quietly does nothing useful; they get a sentence naming exactly what is missing, the same sentence `checkHost` already gives for a status it cannot parse on any host.

## Alternatives rejected

- **Treat a clean `version` exit as logged in.** This is the "silently treating installation as login" the node explicitly forbade. It would pass preflight for anyone with the CLI on their PATH and an expired or absent session, and the failure would arrive three minutes into a worktree instead of before one is cut — the exact regression `checkHost` exists to prevent (`PR-05-04`).
- **Read `doctor`'s output and guess at its keys.** BUILD-PLAN §6's rule is not "read something," it is "read something documented." `doctor`'s shape is not, and a guessed key that changes on the next Cline release fails silently rather than loudly.
- **Wait for a live CLI install before writing the adapter.** Cursor's adapter (ADR 0048) already set the precedent of building from a published reference alone, with the gap recorded rather than hidden. Cline's own gap — no auth probe — is the same kind of honest incompleteness, not a reason to withhold the row entirely.
