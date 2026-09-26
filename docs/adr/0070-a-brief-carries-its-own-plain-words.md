# 0070 — A brief carries its own plain words

- **Status:** accepted
- **Date:** 2026-09-26
- **Refines:** ADR 0057
- **Evidence:** `docs/RUN-COST-TODO.md` (B1)

## Context

After `write_brief`, the host saw three instructions that disagreed:

1. The server instructions: paste the block a tool returns.
2. The tool result: the whole technical brief, then "explain in plain language,
   do not paste it".
3. The skills: explain in plain language.

Models resolved this differently. Some pasted the technical brief, and some
summarised it.

## Decision

- `write_brief` takes `plain: {what, why, check, risk}`, short and in everyday
  words, and stores it on the brief (optional in the schema, so older briefs
  still read).
- The tool returns only a block that the server renders from `plain`
  (`renderPlain`), with one positive instruction: paste it as it is, then ask.
- `brief` and `approve` use the same block. A brief with no `plain` falls back
  to the old wording.
- The brief skill also asks the author to name the files and line ranges in
  `approach` ("Where: path:120–180"), so the worker does not search for them.

## Consequences

- Every model copies the same block. The wording depends on the model that wrote
  the brief, not on the one that relays it.
- The technical brief no longer sits in the tool result, so there is nothing
  there to paste by mistake.
