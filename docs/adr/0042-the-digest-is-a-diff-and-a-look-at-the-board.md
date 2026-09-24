# 0042 — The digest is a diff and a look at the board

- **Status:** accepted
- **Date:** 2026-09-07
- **Covers:** DESIGN §7.1, the digest — its two halves, its fetch, and its flag

## Context

Reopening the board should say what changed since you last looked (D38). The
obvious way to build that is a stored pointer: the timestamp of the last visit,
written somewhere, and everything after it is news.

§7.1 refuses that, and the refusal is the whole design. Git already tracks
where the last sync left the board — the remote-tracking ref is that pointer,
maintained by the thing that moves the board, with no second record to keep in
step. Adding one would create a fact SOBER has to write, migrate, merge and
repair, in exchange for something already on disk.

But the ref only answers half the question. "Three agents were running when I
closed the board" is not in any diff: it is what is true here, now, and it is
the half a single user with no remote actually needs.

## Decision

**One read, two halves, and the halves fail separately.**

`digest(paths, { fetch })` returns `{ delta, unreachable, inReview, flagged }`.
`delta` is null exactly when `unreachable` says why. The snapshot half is
computed from the board on disk and is unaffected by anything the other half
did.

### The failure is a field, not an exception

This is the shape `board.broken` already has, for the same reason: a surface
that gets an exception where it expected a board renders nothing, and "the
remote could not be checked" is not a reason to show a person no digest.

Every empty delta says which kind of empty it is, because "nothing changed" and
"nothing was checked" are opposite facts that a blank line reports identically:

| What happened | What it says |
| --- | --- |
| No remote at all | this repository has no remote — the board is only on this machine |
| Fetch failed | `<remote>` could not be reached — open the board again when you have a connection |
| Either ref missing | this board has not been shared yet — `sober sync` puts it on `<remote>` |

A fetch that fails with git's "couldn't find remote ref" is not an unreachable
remote — it is a remote with no board yet — and it falls through to the third
row, which is the one with something to do in it. `sync.ts` makes the same
distinction for the same reason, and getting it wrong there would push over a
board it never saw.

### `fetch` is a parameter, not a comment

§1.2 permits an automatic fetch and forbids an automatic pull. A fetch moves
one ref, writes nothing into the working tree and merges nothing, so neither
harm the pull rule names applies to it.

That permission is not a licence to fetch on a two-second poll. The dashboard
asks for a fetch once, when the board is opened, and the poll that follows never
touches the network — so the distinction lives in the signature where a caller
has to answer it, rather than in a comment above a function that always fetches.

### The delta is a diff, read with `--no-renames`

`git diff --no-renames --name-status -z <board branch> <remote>/<board branch>`
over `.sober/nodes` and `.sober/decisions`.

`--no-renames` because a record file renamed inside `nodes/` is a delete and an
add, and the add is a new node — which is what the digest should say about it.
Handling `R` would be a second parse of the same fact. `-z` because these are
paths from a directory a person may edit by hand, and NUL is the one separator
git never quotes around.

An `A` is a new node. An `M` is read on both sides and reported only when the
field went from null to a record — `answer` for a decision, `accepted` for a
node. An edit to a title is a change and is not news: §7.1 lists five things and
"somebody rewrote a description" is not one of them.

A decision that arrives already answered is therefore silent, because it never
went from null to a record here. That follows §7.1's wording and its sense: the
digest reports what happened to the things you were waiting on, and a question
you never saw asked is not one of them. §7.1 has a line for a new node and none
for a new decision, which is the same judgement written down.

A git failure with both refs present is caught and reported as an unreachable
delta rather than thrown. The claim that the halves fail separately has to hold
for every way the first one can fail, not only the ones with a nice message.

The record is read loosely rather than parsed through its schema. A file a newer
SOBER wrote must not take the digest down with it (§8.4); it simply has nothing
to report.

### The archive is outside the pathspec, not filtered inside it

Archiving is a rename into `.sober/archive/`, which under this pathspec is a
delete — and a delete is not one of §7.1's five things. Widening the pathspec to
exclude it again would be two decisions where there is one.

### The flag is derived now, in `flagsOf`, ahead of the flow that uses it

§7.1 lists flagged nodes and §2.8 defines the flag, but until this change
nothing on the board ever set one: `accepted.flagged` was a field written as
`false` by the only thing that wrote it.

So `flagsOf` gains `flagged`: a node whose bound decision carries an answer
written after that node's brief was approved. Timestamps compare as strings
because `Timestamp` is ISO-8601 and UTC, which is the property that makes them
sortable without being parsed.

An answer written at the same instant as the approval is not a change — a brief
is rendered from the answers it was approved against — so the comparison is
strictly later, never later-or-equal.

This is §2.8's broader definition and not the narrow "a finished node whose
decision changed". §2.8 records what the narrow reading cost: an `in-review`
node whose brief approval had just been withdrawn still read `in-review`,
was accepted against an answer that had changed, and was never flagged, because
at the moment of the change it was not yet finished. The derivation lands here
rather than in the flagged-node flow so that flow consumes one answer instead of
writing a second.

### It shows on one surface

The dashboard, per BUILD-PLAN §M3. `PR-09-08` requires parity for
**state-changing** operations, and a read is not one — "hovering and panning are
not operations". The core read and the wire shape are surface-agnostic, so
`sober status` picks it up in a one-screen diff the day it asks.

### It is a bar, and it is dismissed

Under the header, above the canvas, in the place the failure line already
occupies. It is read once and closed; a modal would turn a glance into a thing
to get past, and a card floating over the canvas would need Escape handling and
a layer order against the panel for a strip of counts.

A count of zero writes no line. A digest listing three things you have already
dealt with makes the reader do the filtering the digest exists to do.

## Consequences

- `core` gains one export, `digest`, and `schema` gains two, `Digest` and
  `Delta`. Both went past the export ratchets deliberately.
- `flagsOf` returns a second field, so the two places that compared its whole
  shape were updated. The CLI reads `lastRunFailed` and ignores the new one:
  `sober status` has no flagged line until something asks for it.
- The server has a fourth read. The comment that said "deliberately three" was
  guarding against a read written before a screen asked for one — the panel and
  the decision screen added none, which is that guard working.
- The delta half is exercised against real git with two clones and a real bare
  remote, in the integration project. There is no mock: every failure this code
  has is git's.
- Nothing is stored, so nothing migrates. A board upgraded from any earlier
  version gets a digest on the first open with no field added to any record.

## Alternatives rejected

**A stored "last seen" pointer.** The obvious build, and it makes the digest
exact rather than sync-shaped: it would answer "since you last looked" instead
of "since the last sync". It also adds a record to write, merge, and repair, and
puts a fact in `local/` whose loss silently changes what the board reports. §7.1
took the ref that already exists over the record that would have to be kept.

**Two reads the caller composes.** The delta half can fail independently, and a
caller that composed them would have to decide what a half-failure means — in
the browser, where `core` cannot be imported and the decision would be made
twice. One read makes the partial answer a shape rather than a convention.

**Always fetching inside the read.** The simplest signature, and it makes the
read unusable on a timer with nothing in the type saying so. The rule would live
in a comment, which is where v0 kept the rules that nothing checked.

**Reading the flag from `accepted.flagged` only.** Strictly inside this step's
scope, and the line would have shipped permanently empty: nothing writes that
field yet. A digest item that is structurally always zero is worse than no item,
because it reads as an answer.
