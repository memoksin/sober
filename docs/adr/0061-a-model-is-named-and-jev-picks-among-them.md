# 0061 — A model is named, and Jev picks among them

- **Status:** accepted
- **Date:** 2026-09-21
- **Refines:** [ADR 0058](0058-a-tier-names-its-host-and-model.md), [ADR 0060](0060-jev-scores-the-node-and-names-its-skills.md)

## Context

ADR 0058 gave a board three buckets: a brief's score lands in `low`, `mid` or
`high`, and each names one command line. Three is the wrong number for anyone
with more than three subscriptions, or with two models that both fit the
middle and differ in what they are good at. And a score is a poor key for
"which model": it says how hard the node is, not what kind of hard.

ADR 0060 put Jev on the score. Jev reads the brief and produces the number,
which fixes the guessing — but the number still lands in a bucket, so Jev's
reading of the task is spent by the time a model is chosen.

## Decision

`dispatch.models` is a list, any length, each entry a command line like
`dispatch.host` with the complexity range it covers, a name, and one line of
`about`:

```jsonc
{ "name": "free",  "run": "opencode --model openrouter/qwen/qwen3-coder:free",
  "complexity": [1, 3], "about": "Free. Small edits and tests." }
```

Four things follow, each chosen on purpose:

**A provider is a command line.** OpenRouter, OpenAI and Anthropic are reached
the way ADR 0058 already reaches them — through the host CLI the user logged
into, with the model flag on the line and the adapter's own arguments after
it. SOBER gains no API client and no tool loop.

**The list is preference order, and it wins over the tiers.** Where ranges
overlap, the first covering entry runs when nobody asked Jev. `tiers` and
`thresholds` stay for the board that has them; a list, once set, is what is
read. Two mechanisms is a cost taken deliberately: retiring the tiers would
break every published config for a feature that is additive.

**Jev chooses among the entries that cover its score — and only those.** The
constraint reaches Jev as the set it is shown: an entry outside the range is
not on the list, so nothing it picks can be out of range, and there is no
second rule to keep in step with the first. `about` is the criterion text; an
entry with none is described by its command line. Two round trips at most, and
none when one entry covers the score.

**The run record's `tier` becomes a string.** It holds whichever chose the
line — a tier's name or an entry's — and a record from before this ADR reads
unchanged. Renaming it to `model` would have been more honest and would have
needed the first migration of run records; a string with a comment is the
cheaper honesty. `fallback` keeps its meaning: `dispatch.host` ran because the
tier named none, or because no entry covered the score.

## Consequences

- `sober logs` and the dashboard say `ran <line> (<name>)`; the word "tier" is
  no longer appended, since a name like `free` is not one.
- A `models` list makes a node's score reach Jev twice: once to be scored,
  once to be placed. The second call is skipped whenever it would be trivial.
- `about` is prose the user maintains, and the only thing Jev knows about a
  model. A stale line steers a wrong choice; that is the cost of not asking
  SOBER to know what each model is good at.

## Alternatives rejected

- **Show Jev every model and validate the range afterwards.** One call, but a
  pick outside the range is thrown away and replaced by the list rule — Jev's
  reading of the task, which is the whole point, is discarded exactly when it
  disagrees.
- **Retire `tiers` and `thresholds`.** One mechanism, and a broken config for
  every board that has them.
- **Rename `tier` to `model` on the run record.** A run-record migration for a
  field name.
