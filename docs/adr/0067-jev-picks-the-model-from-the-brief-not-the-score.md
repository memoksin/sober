# 0067 — Jev picks the model from the brief, not the score

- **Status:** accepted
- **Date:** 2026-09-26
- **Amends:** [ADR 0061](0061-a-model-is-named-and-jev-picks-among-them.md)

## Context

ADR 0061 had Jev choose "among the entries that cover its score — and only
those": the node's own complexity score, a number Jev itself just produced,
is used to narrow the candidate list before Jev is asked which of them fits.
The reasoning at the time was that a pick outside the range can't happen if
the range is the list.

In practice this makes the score decide twice, in two different ways, and lets
the cruder of the two win. A node whose score lands where only one entry's
range reaches gets no real choice at all — Jev is shown one name and asked
nothing. A node whose score sits just outside every range gets none, and
falls back to `dispatch.host` even though a model on the list may have been
the right fit for what the brief actually asks for. Jev already read the
brief once, in full, to produce the score; asking it to pick a model from a
number-narrowed subset of that same brief throws away the read exactly when
it would have disagreed with the range.

## Decision

**The model-choice question shows Jev the whole list it was handed** — the
budget already built into that list by `dispatch.models` pins and
`dispatch.sources` ranges (ADR 0063) — not the subset whose complexity range
covers Jev's own score. `modelQuestion` and `askJev` no longer call
`modelsFor` to narrow the set; every entry in `ask.models` is a candidate,
and Jev picks by reading `about` against the brief already in `state`.

The score question is unchanged and still asked: it is still logged, still
drives `dispatch.thresholds` and `tiers` on a board with no `models` list, and
still gates `jevSkills`. It stops being a second filter on the model the
first filter (Jev's own judgment) is allowed to name.

**The backup question follows the same rule.** `backupCandidates` is called
with no complexity from the Jev path, so host-diversity (never the primary,
never a second free entry behind an `openrouter` primary) is still enforced,
but the complexity-covering preference that used to sort candidates before
Jev saw them is dropped — Jev sees every host-diverse candidate, not the
range-narrowed ones first.

**`dispatch.models`/`dispatch.sources` complexity ranges keep their old
meaning everywhere else.** The non-Jev path — `modelForScore`, `tierFor`,
`hostForTier` — is untouched: with `jevMode` off, or with `jevMode` on and
only one model on the list, the score still decides deterministically exactly
as ADR 0058 and ADR 0061 described. And a range still caps which models
`dispatch.sources` discovers into the catalogue at all (ADR 0063) — that
budget question is orthogonal to this one and is not what this ADR changes.

## Consequences

- The choice question is noisier: its criteria is the whole list handed to
  `askJev`, not a score-narrowed subset. A board with a wide `models`/
  `sources` spread hands Jev more to read on every dispatch.
- A wrong pick is now only an `about` problem. Before, it could also be a
  range-config problem — a range drawn one point too narrow silently removed
  a model from consideration no matter how well its `about` fit. That
  failure mode is gone; the only knob left for "Jev keeps picking the wrong
  model" is the line of prose it reads.
- A node scored low can now run on the most expensive model on the list, and
  one scored high can run on the cheapest, if that is the fit Jev reads from
  the brief. The complexity ranges on `dispatch.models` entries stop being a
  ceiling/floor on Jev's choice; they remain one on the non-Jev deterministic
  path and on what `sources` discovers.
- `jev.test.ts` cases asserting a range-covered subset (`modelsFor` called
  from inside `askJev`) are rewritten to assert the full list is shown
  regardless of score.

## Alternatives rejected

- **Keep the range as a hint: fall back to the whole list only when nothing
  covers the score.** Half a fix — wherever a range does cover the score,
  the number keeps deciding, and a range drawn one point too narrow is still
  a silent ceiling on Jev's read of the brief.
- **Ask for score and choice in one call, with the ranges folded into the
  criteria text Jev reads.** Fewer round trips, but ties the exact wording of
  `about` to the exact wording of an inline range description — two places to
  edit to fix one bad pick instead of one.
- **Drop the score question for boards with a `models` list.** The score
  still has a job — it is what `dispatch.thresholds`/`tiers` and
  `jevSkills` read, and what a board with no `models` list runs on entirely.
