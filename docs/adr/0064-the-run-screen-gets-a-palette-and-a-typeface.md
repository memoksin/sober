# 0064 — The run screen gets a palette and a typeface

- **Status:** accepted
- **Date:** 2026-09-24
- **Amends:** [ADR 0039](0039-colour-means-status-and-the-canvas-is-the-application.md)

## Context

`docs/design/watch-the-run.html` is the approved mockup for the run screen —
the session overlay `apps/dashboard/src/logs/` renders when a node's
transcript is opened. ADR 0039 §2 reserves colour for status and forbids
decoration everywhere else. A transcript that reads `tool` / `result` /
`error` / `thinking` / `you answered` at a glance, and a model badge that
carries a provider's own mark, both need colour that is not status — the
mockup already spent forty seconds of scripted replay finding values that
work, and this node turns those values into a record and into tokens. It
changes no component: session-shell, tool-blocks and session-statusbar
consume the tokens later.

## Decision

Two named exceptions to ADR 0039 §2, each with the same limit: **never the
canvas, never the rest of the chrome — only the run screen
(`apps/dashboard/src/logs/`).**

### 1. The transcript palette

`--tx-tool`, `--tx-result`, `--tx-error`, `--tx-think`, `--tx-human`,
`--tx-pass`.

Tool and human share periwinkle, hue 275 — an agent's action and a person's
answer are both "something happened here", not a status, and grouping them
keeps the palette to three families rather than five. 275 sits equidistant
from `running` (235) and `blocked` (300), ADR 0039's two blue-violet
statuses; a transcript line reading as "the agent is running" or "this node
is blocked" would borrow meaning that belongs to the canvas.

Error is rose, hue 350. Think is magenta, hue 325. Both sit on the warm side
opposite blue, clear of `danger` (25, ADR 0039 §2's own exception) by 325°
and 295° of hue respectively — an error line in the transcript must never
read as the one place ADR 0039 lets colour confirm an irreversible action.
Neither sits near `held` (45): a warning inside a transcript is not a
decision waiting on the user.

Result stays neutral — `oklch(*, 0.008, 260)`, the same near-zero chroma as
`--ink-dim`. A tool's output is the majority of a transcript's text; giving
it a hue would be the loudest colour on the screen for the thing that most
needs to recede.

**The checklist ✓ gets its own `--tx-pass` token and stops borrowing
`--status-ready`.** `--status-ready` means "yours to start" (ADR 0039 §1) —
a passed acceptance check inside a finished run's transcript is not waiting
on anyone to start it, and reusing the token would teach a reader that the
colour means two different things depending on where it appears. `--tx-pass`
is a desaturated teal-green at hue 168, `oklch(0.62 0.07 168)` dark /
`oklch(0.46 0.07 168)` light — 18° from `--status-ready`'s 150 in hue, and
chosen with a third of `ready`'s chroma (0.07 against 0.16) so the two do
not read as the same colour at a glance even where hue alone would be close.
The greyscale check ADR 0039 §1 requires: `ready` sits at L 0.74 (dark) /
0.55 (light); `--tx-pass` sits at L 0.62 (dark) / 0.46 (light) — a 0.12 /
0.09 gap, enough that the pass mark does not collapse onto `ready` for a
reader who cannot see hue at all.

### 2. Provider brand colours

`--provider-anthropic`, `--provider-openai`, `--provider-google`,
`--provider-mistral`, `--provider-other`, OKLCH approximations of each
brand's mark. They appear in exactly one place — the model badge in the run
screen's title bar, next to that provider's own logo — and nowhere else on
the run screen, let alone the canvas.

`--provider-mistral` (hue 55) sits only 10° from `--status-held` (hue 45).
That is closer than any pairing ADR 0039 §1 tolerates on the canvas, and it
is tolerable here for one reason: the badge never sits next to a status. A
node's status lives on the canvas and in the node panel; the model badge
lives inside an opened session, a surface ADR 0039 §4 already treats as a
panel over the canvas rather than the canvas itself. The two colours are
never simultaneously on screen making the same claim, so the proximity
costs nothing a reader would notice.

`--provider-other` is `var(--ink-dim)` — a provider sober cannot identify
gets no invented brand colour, it gets the same neutral every other
non-status element already uses.

### 3. Typeface

The transcript and code read in **JetBrains Mono**; prose inside the
transcript (a text line, an answer) reads in **IBM Plex Sans**. Both are
bundled through `@fontsource` / `@fontsource-variable`, never fetched from
Google Fonts. `sober dashboard` serves the dashboard locally, ADR 0008 keeps
the browser talking only to the server, and the tool has to keep working
with no network reachable at all — a `<link>` to `fonts.googleapis.com`
would be the one request on the whole page that leaves the machine.

`--font-mono` / `--font-ui` — the system stacks ADR 0039 §3 already
defines — stay the fallback in both new tokens
(`--font-transcript-mono`, `--font-transcript-sans`), so a build without the
webfont files still renders. The chrome outside the transcript keeps the
system UI font; this node does not touch it.

## Consequences

- `apps/dashboard/src/theme.css` carries eleven new tokens (six `--tx-*`,
  five `--provider-*`) in all three places the file already repeats its
  values — `:root`, `@media (prefers-color-scheme: light)`, and
  `[data-theme="light"]` — plus two new font tokens in `@theme`.
- `apps/dashboard/package.json` gains `@fontsource-variable/jetbrains-mono`
  and `@fontsource/ibm-plex-sans`; `@besober/cli`'s published dependencies
  are untouched, because the dashboard ships inside that bundle rather than
  publishing its own (ADR 0007).
- The existing no-hex test in `test/integration/theme.test.ts` keeps
  passing unmodified; new assertions in the same file require every
  `--tx-*` and `--provider-*` token in both themes, and refuse a Google
  Fonts URL anywhere in `apps/dashboard/src`.
- A future status added to `STATUSES` still only ever needs a
  `--status-*` token on the canvas; it never needs a transcript or provider
  token, and nothing here widens what counts as status.

## Alternatives rejected

- **Reuse `--status-ready` for the checklist ✓.** Rejected above: it would
  make the same token mean "yours to start" on the canvas and "this already
  happened" in a transcript, the exact ambiguity ADR 0039 §1 exists to
  prevent.
- **Fetch JetBrains Mono and IBM Plex Sans from Google Fonts, as the
  mockup's own `<link>` does.** The mockup is a standalone design file with
  no offline requirement; the shipped dashboard has one (ADR 0008), so the
  fonts move to `@fontsource` instead of the mockup's CDN link.
- **Give providers a status-shaped token (`--provider-status-like`) so a
  future "this model is degraded" indicator could reuse the hue.** Nothing
  in this node needs that, and a provider colour standing in for a status
  later is the same mistake `--tx-pass` was written to avoid making now.
