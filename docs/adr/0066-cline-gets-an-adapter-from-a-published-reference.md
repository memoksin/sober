# 0066 — Cline gets an adapter, from a published reference and its own source — never a plugin

- Status: accepted
- Date: 2026-09-25
- Refines: ADR 0048, ADR 0052, `DESIGN.md` §2.9, §5.1, `BUILD-PLAN.md` §6

(The node that opened this work names it ADR 0063. That number was taken by
`0063-jev-chooses-from-the-live-catalogue.md` before this branch merged, the
same collision `0049-the-auditor-runs-the-acceptance-list.md` named for its own
node. This is the next free slot.)

## Context

ADR 0048 built Codex and OpenCode from installed CLIs; ADR 0052 built Cursor from a published reference because no CLI was installed here. Cline is the fifth host, and it forced a third method: the published reference at `docs.cline.bot` turns out to be stale for the one thing that matters most — the shape of `--json` output — and the CLI *is* on npm, so the source itself was read instead of trusted docs (`npm view cline version` → `3.0.65`, matching `cline/cline`'s `main` branch, commit `8bbdde2` for the event wrapper).

Two things fell out of that reading that the node's own brief anticipated and asked to be resolved rather than guessed at.

## Decision

**The adapter, not a plugin.** This node builds `hosts.ts`'s table row only. A Cline plugin — MCP config and skills installed into a Cline session, so `/sober:decide` works from inside one — is real future work and is not this node; nothing here should be read as Cline having decisions-in-session or an attended run, and the README says so.

**The `--json` event shape is `agent_event`, not `say`/`ask`.** `docs.cline.bot/cli/cli-reference` documents `{"type": "say"|"ask", "text", "ts", "say", "ask", "partial"}`. Nothing in the installed CLI emits it. `apps/cli/src/utils/events.ts`'s `handleEvent` writes `emitJsonLine("stdout", { type: "agent_event", event })` for every one of the CLI's own `AgentEvent`s (`sdk/packages/shared/src/agents/types.ts`), and the README's own automation example filters on exactly that shape (`select(.type == "agent_event" and .event.text)`). The adapter's `line` function is built against the source, with the doc's shape named in a comment as the one that turned out to be wrong, not silently dropped — a future reader who trusts the site over the code should not have to re-derive this.

**No probe reports login without doing work, and that gap is named rather than papered over.** The node's brief asked for "whatever reports auth without a task," `auth` and `config` as ruled-out interactive commands, and `--version` as explicitly not an auth check. All three were checked against the actual command sources, not the docs:

- `apps/cli/src/commands/auth.ts`: bare `auth` without a TTY only checks *that* — `"interactive auth setup requires a TTY"` — and never reports whether credentials already exist.
- `apps/cli/src/commands/config.ts`: bare `config` without `--json` opens the same TUI the overview page calls "the interactive config view"; `config --json` is genuinely non-interactive but prints workflows, rules, skills, hooks, agents, plugins, MCP servers and tools — never a provider or an auth field. It was read in full; there is nothing to parse for login state.
- `apps/cli/src/commands/doctor.ts`: local CLI and hub-daemon health — stale PIDs, listening sockets — never credentials.

So there is no no-task probe. What genuinely is documented — `apps/cli/README.md` and the repository's own `AGENTS.md` — is that a non-interactive run with no saved credentials fails fast: `AGENTS.md` names it exactly, *"the default `cline` provider fails fast with an `Unauthorized` error"*, instead of opening a browser. `probe` uses that: a trivial one-shot task (`--json --auto-approve true "Reply with ok."`), the same trade Claude Code's own `availability` probe already makes in this file for a different question (spend, not login). `loggedIn` reads the result defensively — a `done` event is signed in, an `error` event whose message names an auth failure is not, and anything else is unread rather than guessed at (§2.8) — never `false` for a network blip or a rate limit it cannot explain.

**This changes `checkHost`'s shared catch.** Every existing probe answers with exit 0 regardless of login state — a status command's whole job. Cline's probe is a real task, and a task with no credentials exits non-zero, which `checkHost` had never had to read: its `catch` gave up with a generic refusal rather than trying `loggedIn` against the failed run's own output. `host.ts` now tries `loggedIn` there too, the same thing `hostAvailability`'s catch already does for `limitSpent` a few lines down — one guard in the shared function, not a special case, and every other adapter's behaviour is unchanged because their probes never took that branch.

**The cost is real and is in the README, not hidden in a comment.** A dispatch to a signed-out Cline account spends one wasted turn before SOBER can say so, where every other host's refusal is free. This is the direct cost of "no lightweight surface," disclosed rather than smoothed over.

**The run.** `--json` is documented as needing "either a prompt argument or piped stdin" and is non-interactive on its own; the brief goes in as the trailing positional argument, the same shape as Codex, OpenCode and Cursor. `--auto-approve true` is the explicit spelling of the CLI's own default, the same call `bypassPermissions` makes for Claude Code. The reference documents `-s, --system <prompt>` — real, and not "no such flag" — but it *replaces* Cline's own system prompt rather than adding to it (`cli-reference.md`: "Override the default system prompt"), which is a worse trade than the one every other flagless host already makes. `NO_HUMAN` goes in front of the brief, not into `--system`.

**No model catalogue.** `sober models` does not gain a `cline` source. The CLI has no list command; `-m/--model` and `auth`'s quick-setup flags both take an id as free text, never as a choice read back from anywhere. `Candidate.host` in `models.ts` is unchanged.

**Events rendered, and why the rest are not.** `content_start` fires once per streamed chunk of text or reasoning — rendering it would print a message once per token — so only `content_end`, which carries the whole turn's final text, becomes a `text`/`thinking` line. A tool call is the opposite: one `content_start` to say what is running, one `content_end` to say how it went, the same "start once, finish once" split Claude Code's own `tool_use`/`tool_result` pair keeps. `input` on a tool call is typed `unknown` in the source — no key is common enough across Cline's own tool set to read a one-line `detail` from, so it stays null, the same call Cursor's adapter makes for a tool it cannot name a key for. `done` is the result line; `error` at the run level is the one shape that renders `raw`, carrying whatever prose the host said. `iteration_start`, `iteration_end`, `usage` and `notice` carry nothing a person watching a run needs repeated, and are not rendered.

## Consequences

- `core` gains one adapter and one field on `Event`; `checkHost`'s catch gains one branch shared by every host, not a Cline-specific one.
- `hosts.test.ts` and `test/integration/other-hosts.test.ts` cover five hosts where they covered four; the fake CLI (`test/integration/hosts/cline.mjs`) tells its probe apart from a real dispatch by the exact probe prompt, because Cline's CLI does not give it a second flag set to tell them apart with.
- `README.md` gains a **Cline** section beside OpenRouter's — no plugin, dispatch only, the probe's real cost named — and a row in the host table with both session columns `no`.
- **What is proven and what is not.** The tests dispatch to Cline end to end against a real repository, a real worktree and a real child process, with the host faked (ADR 0014) from the shapes the installed source emits. They do not prove that a live `cline` binary is on the machine this runs on, that npm `cline@3.0.65` is still current by the time this is read, or that the `Unauthorized` wording `AGENTS.md` documents survives the next release. `docs/testing/v1x-4-other-hosts.tdd.md` says so rather than claiming a recording that does not exist.

## Alternatives rejected

- **Treating `--version` or a successful spawn as "logged in."** Explicitly ruled out by the node's own brief, and it is exactly the failure ADR 0048 named for an unknown host generally: a machine where the user believes it is configured and it is not.
- **Leaving `probe`/`loggedIn` unwired and refusing to add Cline to `ADAPTERS`.** Reads the node's "do not fake readiness" as "do not ship," which is a stronger claim than the evidence supports — a real, if costly, signal exists (the fail-fast `Unauthorized`), and using it is not the same as inventing one.
- **A `--system`-based `NO_HUMAN`.** Cline's `--system` is real, unlike Codex's, OpenCode's and Cursor's total absence of one — but it replaces the default prompt outright, and losing whatever that prompt does for Cline's own tool use is a worse trade than the brief-prefix every other flagless host already takes.
- **Trusting `docs.cline.bot`'s `--json` schema.** It is the "Help Menu (Source of Truth)" page for flags, and it is wrong about the one shape that matters most for this adapter. The installed source is the tiebreaker BUILD-PLAN §6 exists for, and the doc's shape is kept in a comment specifically so the next reader does not rediscover the mismatch by writing a renderer that silently drops every event.
- **A Cline-specific branch in `checkHost` instead of a shared one.** The failure mode — a probe whose exit code does not imply readable output — is a fact about what a probe *is*, not about Cline. `hostAvailability` already reads a failed probe's output a few lines below; `checkHost` not doing the same was the gap, not a Cline exception to carve around it.
- **Shipping the Cline plugin now.** It would fold a second, larger decision (what Cline's own elicitation or hook surface can carry) into an ADR about the adapter, the same shape ADR 0052 refused for Cursor's hook.
