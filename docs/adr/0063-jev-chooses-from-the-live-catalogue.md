# 0063 — Jev chooses from the live catalogue

- **Status:** accepted
- **Date:** 2026-09-23
- **Amends:** [ADR 0061](0061-a-model-is-named-and-jev-picks-among-them.md)

## Context

ADR 0061 gave `dispatch.models` its shape: a hand-typed list, each entry a
command line, a complexity range, and one line of `about`. It is exactly the
list Jev sees — nothing more, nothing less. That list goes stale two ways at
once. A pinned entry outlives the model it names: Codex retires a slug, an
OpenRouter free model disappears from the catalogue, and the pin keeps
running until a person notices the failures. And a new model a board would
want — a fresh free OpenRouter entry, a Claude release — is invisible until
somebody edits `.sober/config.jsonc` by hand.

Three catalogues already exist in `packages/core/src/models.ts`, written for
`sober models` (ADR 0061's own consequence): `claudeModels`, `codexModels`,
`openRouterModels`. Dispatch never read them. This amendment is that reading.

## Decision

**The list Jev and the score-only path choose from is built at dispatch
time**, from `dispatch.models` (pins) topped up by a new `dispatch.sources`
block — per source (`claude`, `codex`, `openrouter`) a complexity range and an
optional `only`/`deny` of `*`-glob id patterns, matched against the literal
`--model` argument a catalogue names. A source not named in `dispatch.sources`
contributes nothing — today's boards, with `sources` empty, run unchanged.

**A pin wins a name clash, and is checked against the source it names.** A
`codex` or `openrouter` pin whose id has vanished from a *reachable*
catalogue is dropped as retired, with a reason. A `claude` pin, or a pin on a
source this dispatch could not reach, is kept unconditionally — there is
nothing to check it against. A discovered entry clashing with an earlier one
(a pin, or an earlier source's discovery) is dropped too. Every drop is named
in one `models` log event per dispatch, alongside the count Jev was shown, so
a list that got smaller is a diff line in `sober logs`, not a silent change in
what a node could run on.

**The Claude table holds aliases, not dated ids.** `CLAUDE` in `models.ts` now
reads `['opus', 'opus', …]`, `['sonnet', 'sonnet', …]`, `['haiku', 'haiku',
…]` — the run line is `claude --model opus`, and a new Claude release needs
no code change here, because Claude Code itself resolves the alias. Fable has
no alias yet, so its entry still carries the dated id. Because an alias run
does not say which snapshot actually answered, the claude adapter's
`system`/`init` line now reads `session started (<id>)` when the init event
carries a `model` — the one place that says what ran.

**A fetch is best-effort, cached, and named-only.** `liveModels(paths,
dispatch, deps)` calls `claudeModels`, `codexModels(home)` and
`openRouterModels(fetch)` only for the sources `dispatch.sources` actually
names, through a cache at `.sober/local/catalogue.json` (`{ at, models }`),
fresh for `dispatch.catalogueSeconds` (default one hour). A fetch failure is
logged and that source is treated as unreachable for this dispatch — an
OpenRouter outage must not stop one. `deps` injects `fetch`, `home` and `now`,
so no test touches the network or `~/.codex`.

**`dispatch.models` still pins a hand-named entry**, unchanged in shape from
ADR 0061 — it is the escape hatch for a model no catalogue lists, or a board
that wants exactly one thing and nothing discovered.

## Consequences

- `sober models --sources` prints what Jev would see at the next dispatch —
  the built list, and the drops — so the effect of a `dispatch.sources`
  change is checkable by hand before it changes what runs.
- Jev's prompt now carries the filtered catalogue — tens of free OpenRouter
  entries where a board names one — so its choice is noisier, and `about` is
  the provider's own blurb rather than one a person wrote for it.
- A brand-new free model with a broken provider is picked before anybody
  tried it; the run record names a model nobody wrote down, and the backup
  tier catches the failure, not the waste.
- One catalogue read per dispatch when the cache is stale, cached in
  `.sober/local/`, gitignored like the rest of `local/`.
- This repository's own board (`.sober/config.jsonc`) moves its Codex pins
  and its three hand-named free OpenRouter pins to `sources: { codex: {
  complexity: [4, 10] }, openrouter: { complexity: [1, 3], only: ["*:free"]
  } }`, and its Claude pins to the `opus`/`sonnet` aliases.

## Alternatives rejected

- **Keep `dispatch.models` as the only list, and add a `sober models sync`
  command that rewrites it.** A person still has to remember to run it, and a
  stale list between syncs is exactly today's failure.
- **Drop a retired pin silently, with no log line.** A list that shrinks
  without a trace is the harder failure to debug — a node that used to have a
  cheap option and quietly stopped having one.
- **Check a `claude` pin against the fixed alias table too.** The table is
  four names; a typo there is a `dispatch.host`-style refusal at dispatch
  time already, through `checkHost`, so a second check buys nothing.
