# 0051 — A distribution is proposed in a session and accepted as a record

- Status: accepted
- Date: 2026-09-08
- Moves: `SCOPE.md` SHOULD → MUST #19
- Implements: `DESIGN.md` §3.3, ADR 0005
- Borrows: ADR 0004's propose-then-accept, ADR 0009's line about where a model runs

## Context

ADR 0005 put AI distribution on the SHOULD list in one line — "nodes allocated
by matching each contributor's role and focus" — and split the four team
capabilities by where the loop stops needing them. Claim and assignment went to
MUST because two people cannot work in parallel without knowing who has what;
allocating _intelligently_ only improves a loop that already closes.

That reasoning still holds, and it is not what makes this ready. Two facts
arrived after it that the sentence could not have accounted for.

**The first new fact is that nothing could be matched.** `Contributor.focus` was
`z.string()`, free text, and the schema said so in a comment written at the time:
"Allocating work by matching a role and a focus is v1.x; until something reads
them, a fixed vocabulary is a guess." A board where one person's focus reads
`core, cli` and another's reads `the dashboard and anything React` is not a
record a rule can match against — it is a note to a human. The feature ADR 0005
described could not be built against the record ADR 0005 shipped, and nobody
noticed because nothing had tried.

**The second is that a place to run a model now exists.** ADR 0009 made the MCP
server a MUST and drew the line: work that needs a model happens in the host
session that already holds the repository in context, and `AGENT_OPERATIONS`
names the two that do — `propose` and `open_decision`. When ADR 0005 was
written that list did not exist, so "AI distribution" had nowhere to be except
inside `core`, as a heuristic. It has somewhere else now.

There is a third thing, not a fact but a rule this has to obey. `SCOPE.md`'s
WON'T list says "decomposition that lands without human acceptance — the human
owns intent", and ADR 0004 narrowed it precisely: what is excluded is
decomposition that _lands_ unreviewed, not decomposition that is _proposed_.
A distribution is the same shape and takes the same rule.

## Decision

**The matching happens in a host session, and never in `core`.** `distribute`
joins `AGENT_OPERATIONS` beside `propose` and `open_decision`. The session reads
the board, the team and each person's focus, and writes a plan. No surface routes
it, and the contract test says so.

The alternative was a rule in `core` over the same two fields. It is testable and
dumb, and that is the whole of its case: a heuristic that scores a free-text
focus against a glob list is a number nobody can explain a week later, and the
day it allocates something surprising there is no reasoning to read — only a
formula to argue with. A session can say _why_, in a sentence, and that sentence
travels with the plan.

**A distribution is proposed and never applied.** This is ADR 0004's rule in its
second setting, and it is the load-bearing constraint here. The proposal changes
no node. Accepting it is what assigns.

**The proposal is a record**, `.sober/distribution.json`, board state beside
`contributors.json` for the reason §3.3 gives about the team: who does what is a
property of the project rather than of one machine. Kept rather than left in the
conversation, because a plan that exists only in a session cannot be read on the
dashboard tomorrow, cannot be argued with by the teammate it is about, and does
not survive a closed tab. Each match carries `because` — the sentence that put
that node with that person — since by the time anybody opens it the conversation
that produced it is gone.

**Accepting and dropping are both operations, on all three surfaces.** Two rather
than one with a flag: putting a plan on the board and taking it off are different
acts, and without the second the only exit from a plan somebody disagrees with is
applying it. `OPERATIONS` grows by two, and the surface manifests and the route
table grow with it — which is `PR-09-08` working, not a cost to avoid.

**In a session, accepting goes through elicitation.** ADR 0010's rule, unchanged:
a human act is put to the human, and this is one — the tool asks before it
assigns, the way `decide` and `approve` do. Telling a model in prose not to
accept its own plan is advice from an agent to itself, which is the thing ADR
0010 argues is unenforceable. Dropping is not asked about: it lands nothing, and
a dialog to tidy up is friction with nothing to show for it.

**It is taken whole or dropped whole.** ADR 0004 already set the granularity rule
and its reason: a decision is accepted one at a time because the risk is that the
human did not understand it; node proposals go as a batch because the risk is
that one is wrong, which is visible and cheap to fix later. An assignment is the
second kind. Somebody who wants seven of eight takes the eight and reassigns one.

**A node somebody has claimed is passed over, and named.** A claim is a fact and
an assignment is a plan (§3.3); writing the plan over the fact is the one thing a
distribution must not do. The skip is enforced in `core` rather than asked of the
session, because the session is where the reasoning is and this is the rule no
reasoning gets to overrule. A finished node is passed over for the same reason in
its weaker form: a plan for work that already landed says nothing. Both are
listed rather than dropped — eight matches on a board of twelve reads as a plan
that ran out of ideas unless the other four are named.

The skip is checked **again at acceptance**. Between a session proposing on
Tuesday and somebody accepting on Thursday a teammate can claim any of it.

**`Contributor.focus` becomes a list of strings** — schema v5, with a migration.
Globs where somebody wrote one, words where they did not. A list rather than a
sentence for two reasons: a glob holds commas (`packages/{core,cli}/**` is one
pattern, not two), and only entry by entry can one be run against a node's
`files`. The migration splits the old sentence on commas and keeps the words as
they were written — inventing globs out of `core, cli` would be guessing at what
somebody meant, and emptying the field would lose it. A session reads both kinds.

## Consequences

- `SCOPE.md` gains MUST #19 and loses its SHOULD entry. `DESIGN.md` §3.3 gains
  the distribution.
- `schema` gains `Distribution` and `Match`, and `SCHEMA_VERSION` moves to 5.
  `MIGRATIONS` grows a second channel: until now every step migrated nodes, and
  this one migrates the team file.
- **The export ceiling moves to 107** (ADR 0028). Four names, one consumer each
  on every surface: `readDistribution` (the CLI's read, the session's read, the
  server's `/read/distribution`), `proposeDistribution` (the session alone),
  `acceptDistribution` and `dropDistribution` (all three). Nothing here is a
  convenience — each takes the lock, and a multi-node write spread across three
  surfaces is how half a plan becomes visible to the other writer (ADR 0025).
- `OPERATIONS` gains `accept_distribution` and `drop_distribution`;
  `AGENT_OPERATIONS` gains `distribute`. `CLI_COVERS`, `MCP_COVERS` and the
  server's route table each gain the two.
- `.sober/distribution.json` joins `.gitattributes` and the board's file list in
  `sync`, so it travels and is never line-merged. **`ensureAttributes` now keeps
  the block in step line by line** rather than writing it once behind a marker:
  this is the first board file added since `init` existed, and the marker would
  have left every board created before it with git line-merging the one file
  nobody thought to look at. Found by writing the test, not by hitting it.
- **`dropDistribution` does not parse before it deletes.** A plan nobody can read
  is exactly the one somebody needs off the board, and going through the reader
  would have put the only way out behind the thing that is broken.
- `sober contributors add --focus` may be given more than once. `--focus a,b` no
  longer means two entries, which is a change to a v1 command; it is the same
  change the record took, and a comma-separated glob was never safe.
- A session that cannot elicit cannot accept, and says which surface can —
  `NoElicitationError`'s existing sentence, one more tool behind it.
- The dashboard gains a bar and a stopping screen. A strip would have been
  cheaper and wrong: assigning thirty nodes is not a glance, and the reason each
  match carries is the thing worth reading.

## Alternatives rejected

- **The matching as rules in `core`.** Testable and reproducible, and it buys a
  score nobody can explain. It also forces the shape of `focus` to be whatever
  the rule can read, which is how a free-text field becomes a controlled
  vocabulary nobody wants to maintain — the "fixed vocabulary is a guess" the
  schema comment refused two milestones ago.
- **Both: a rule in `core` that a session may override.** Two allocators that
  disagree, and a person reading a plan cannot tell which one made it.
- **Leaving `focus` as free text.** It survives longest, because a session reads
  prose perfectly well. What it cannot do is let anything else check the match —
  a glob against `node.files` is the one part of this that is not a judgement,
  and a sentence cannot carry it.
- **The proposal is not a record — the session assigns after the human says yes
  in the conversation.** Smallest diff by a distance: no schema change, no
  migration, no new operations, and `assign` is already on all three surfaces.
  Rejected because the acceptance and the review would then both live in a
  window that closes. A plan about four people that only one of them can ever
  see is not a plan the team can argue with.
- **The assignment _is_ the proposal — write `assignee` directly, since §3.3
  already calls it a plan.** The most defensible reading of the existing
  vocabulary, and it fails on volume: thirty nodes quietly acquiring an owner is
  a change nobody reviewed, which is exactly the shape ADR 0004's WON'T entry
  describes. "Reversible" is not the test; "nobody evaluated it" is.
- **Accepting node by node.** ADR 0004 already priced this: per-item acceptance
  is for the risk that the human did not understand, and an assignment is not
  that risk. A screen with thirty checkboxes is how nobody reads any of them —
  the M1 gate's eleventh defect, in a new place.
- **One operation with an `accept` flag, dropping when it is false.** It reads as
  "accept: no" rather than "take this off the board", and the two are different
  enough that a surface would have to explain the difference in prose.
- **Reassigning what is claimed, with a confirmation (ADR 0032's shape).** It is
  the shape chain claim uses, and it does not transfer: there, the second call
  overwrites a claim with a claim, fact with fact. Here it would overwrite a fact
  with a plan, and the person holding the node finds out from a diff.
- **Proposing on the dashboard too.** It would need a model in the browser or in
  the server, which is ADR 0009's rejected subprocess wearing a new hat. The
  dashboard reads plans and settles them; it does not make them.
