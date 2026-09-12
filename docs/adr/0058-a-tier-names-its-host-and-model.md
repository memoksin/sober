# 0058 — A tier names its host and model

- **Status:** accepted
- **Date:** 2026-09-12
- **Refines:** DESIGN §5.1, [ADR 0048](0048-codex-and-opencode-get-a-plugin-and-an-adapter.md)

## Context

`docs/DESIGN.md` §5.1 said SOBER "never asks for an API key and never chooses
the model", and gave the reason: choosing would make SOBER an agent framework
that owns the tool loop, file access and sandboxing.

The reason survives; the sentence does not. A board now scores a brief from 1
to 10 (`complexity`), and a user wants low work on a free OpenCode model,
middle work on Codex and hard work on Claude Code. That needs SOBER to *name*
a model, which is not the same as *calling* one.

The four adapters already run one at a time behind `dispatch.host`. Nothing in
`hosts.ts` or `dispatch.ts` needs a host per board — only a host per run.

## Decision

SOBER still shells out to the host CLI the user installed and logged into,
still holds no key, and still owns no tool loop. What changes is that the
invocation is chosen **per node** from `dispatch.tiers.high | mid | low`. Each
tier is a command line in the exact shape `dispatch.host` already has —
`claude --model claude-fable-5-1`, `codex --model …`,
`opencode --model minimax/m3-free`. The brief's score picks the tier through
`dispatch.thresholds`. Three hosts may burn at once under one
`dispatch.concurrency`. The tiers are read from the base ref, like every
setting that governs a run (ADR 0019).

### 1. The config carries the model flag; the adapter does not learn it

- **Chosen:** The config carries the flag and its value.
- **Why:** `hosts.ts:6-16` already treats `dispatch.host` as a command line
  rather than a program name, and `hosts.test.ts:10` proves
  `opencode --model anthropic/claude-sonnet-4-5` resolves to the OpenCode
  adapter. This is the choice the repository already made, extended one level
  down: SOBER learns nothing about any model, and OpenCode's unbounded model
  list costs it nothing.
- **Costs later:** Nothing validates the flag. A host that renames it fails at
  dispatch as an exit code three minutes in, with no sentence saying why, and
  the person filling in the config has to know four CLIs' flags rather than
  four model names.
- **Not chosen:** a fifth row in the adapter table naming each host's model flag.

### 2. A brief with no score runs on `dispatch.host`

- **Chosen:** No score means no model flag — `dispatch.host` runs as it does
  today.
- **Why:** Every board and every approved brief that exists keeps working
  untouched, and the migration adds a nullable field and backfills nothing.
  Turning the whole feature off stays a matter of not scoring, which is the
  conservative default `DEFAULT_CONFIG` already argues for.
- **Costs later:** Two invocation paths live side by side forever. "Why did
  this node run on the default model" has two answers — no score, or a score
  whose tier is empty — and every surface that reports the model has to say
  which.
- **Not chosen:** backfilling a default score onto existing briefs.

### 3. One command line per tier

- **Chosen:** Each tier is one command line.
- **Why:** It is the shape `dispatch.host` already has, so one parser, one
  adapter lookup and one refusal path serve both.
- **Costs later:** SOBER cannot read the model back out of the line; it can
  only report the line.
- **Not chosen:** a `{host, model}` pair per tier; a tier→host map beside a
  host→model map.

### 4. A tier with no line falls back to `dispatch.host`

- **Chosen:** An empty tier falls back to `dispatch.host`, and the run record
  says it was the fallback.
- **Why:** A user can fill in one tier at a time without breaking dispatch.
- **Costs later:** A node can run on the default host silently unless every
  surface shows the fallback flag.
- **Not chosen:** refusing the run; requiring all three tiers or treating the
  config as broken.

## Consequences

- The run record names the host line that ran and whether it was the fallback.
  `sober status`, `sober logs` and the run panel show it.
- A refusal — unknown host, not logged in, not attendable — names the tier.
- The adapter table in `hosts.ts` does not change.
- SOBER cannot read the model back out of the line. Decisions 1 and 3 accepted
  that cost.

## Alternatives rejected

- **Calling a model API directly.** §5.1's original ground, still rejected: it
  makes SOBER an agent framework.
- **A model chosen by the agent at run time.** The choice then lives nowhere a
  human set it, and no record says why.
- **A host chosen by the score alone, with one shared model table.** It puts
  model names back into SOBER and couples every host to one list.
