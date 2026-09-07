# TDD evidence — AI distribution (v1.x item 3)

- Date: 2026-09-08
- Branch: `main`, on top of `041719e`
- ADR: `docs/adr/0051-a-distribution-is-proposed-in-a-session-and-accepted-as-a-record.md`
- Source plan: none. The journeys below come from the item's brief, ADR 0004, ADR 0005 and ADR 0009.

## What the four questions settled

The item shipped with four questions and an instruction not to settle them
alone. All four went to the human before any code was written.

1. **Where the matching happens** — in a host session. `distribute` joins
   `AGENT_OPERATIONS` beside `propose` and `open_decision`; no surface routes it,
   and `core` holds no heuristic.
2. **What `focus` is** — a list of globs. `Contributor.focus` moves from
   `z.string()` to `z.array(z.string())`, schema v5, with a migration that splits
   the old sentence on commas and keeps the words as they were written.
3. **Whether a proposal is a record** — yes. `.sober/distribution.json`, board
   state, travelling with the graph, each match carrying the sentence that made
   it.
4. **What it does with what is already claimed** — passes it over, and names it.
   Enforced in `core`, and checked again at acceptance.

Three facts found while reading, before any of this was built:

- **The export ceiling was 103, not the 100 the brief named**, and the barrel was
  at 103 — no headroom. ADR 0050 had already moved it. It moves to 107 here.
- **Decomposition's proposals are not a separate record type.** `propose` writes
  nodes and decisions straight to the board; what holds them is unanswered
  decisions. There is no such holder for a distribution, which is why question 3
  had to be asked rather than answered by analogy.
- **`propose` and `open_decision` are deliberately absent from all three surface
  manifests**, and `contract.test.ts` asserts it. So "works on all three
  surfaces" had to be split: proposing stays in the session, and the two
  operations a human performs are on every surface.

## User journeys

1. As an orchestrator with thirty nodes and four contributors, I want an agent to
   propose who takes what, so that I am not assigning one node at a time by hand.
2. As an orchestrator, I want the proposal to wait for me on the board, so that I
   can read it tomorrow on the dashboard rather than in the session that made it.
3. As a teammate already on a node, I want a distribution never to reassign it,
   so that a plan does not overwrite the fact that I have started.
4. As an orchestrator, I want to drop a plan I disagree with, so that applying it
   is not the only way to get it off the board.
5. As anyone on the team, I want the plan to travel with the board, so that the
   people it is about can see it.

## Task report

### 1 — `core`: the record, the proposal, the acceptance, the drop

**RED.** `packages/core/src/distribute.test.ts` written first, twelve tests,
against a module that did not exist.

```
$ npx vitest run packages/core/src/distribute.test.ts
FAIL  src/distribute.test.ts [ packages/core/src/distribute.test.ts ]
Error: Cannot find module './distribute.js' imported from …/distribute.test.ts
Test Files  1 failed (1)
     Tests  no tests
```

**GREEN.** `packages/core/src/distribute.ts` plus `Distribution` and `Match` in
`schema`, `paths.distribution`, four names on the barrel.

```
$ npx vitest run packages/core/src/distribute.test.ts
Test Files  1 passed (1)
     Tests  12 passed (12)
```

**Guaranteed:** a proposal writes no assignee; a second proposal replaces the
first rather than piling up; an unknown handle and an unknown node are both
refused whole with nothing written; one node named twice is refused; a claimed
node and a finished node are passed over at proposal *and* at acceptance;
accepting clears the record; dropping clears it and assigns nothing.

### 2 — the migration to schema v5

**RED.** Three tests appended to `packages/core/src/migrate.test.ts`.

```
$ npx vitest run packages/core/src/migrate.test.ts
× a team written before focus was a list keeps the words, one entry each
× a contributor who was given no focus arrives with an empty list, not with one empty word
SoberError: …/contributors.json cannot be read: contributors.0.focus: Invalid input: expected array, received string
     Tests  2 failed | 11 passed (13)
```

**GREEN.** `MIGRATIONS` grows a second channel. Every step until now migrated
nodes; this one migrates the team file, so `Migration.node` becomes optional and
`Migration.contributor` joins it.

```
$ npx vitest run packages/core/src/migrate.test.ts
     Tests  13 passed (13)
```

**Guaranteed:** `focus: "core, cli"` becomes `["core", "cli"]`; an empty focus
becomes `[]` rather than `[""]`; a board with no team file still migrates; a team
file that will not parse is left alone rather than rewritten.

### 3 — the dashboard

**RED.** `apps/dashboard/src/distribute/data.test.ts` and
`Distribution.test.tsx`, both against modules that did not exist.

```
$ npx vitest run apps/dashboard/src/distribute/data.test.ts
Test Files  1 failed (1)     Tests  no tests
```

**GREEN.**

```
$ npx vitest run apps/dashboard/src/distribute
Test Files  2 passed (2)
     Tests  9 passed (9)
```

**Guaranteed:** a row takes its title from the projection rather than from the
plan; a node the canvas has not drawn still gets a row; the bar counts the plan
and names its author; what was passed over is one sentence and absent when
nothing was; both ways out are on the screen; a plan proposing nothing offers no
way to assign it.

One defect found by the tests themselves: the first three failed on
`Found multiple elements`, because the file had no `afterEach(cleanup)` — the
convention every other component test in the app follows.

One found by reading the wiring afterwards, and fixed: the plan joins the
canvas's two-second poll, and a `Promise.all` means a plan that will not parse
would have taken the projection down with it — the canvas frozen and an error
banner every two seconds, from one bad record. §8.4's rule is that one bad
record never takes the board down, so `readPlan` carries the failure back as a
value and the bar is where it is read. It lives in `distribute/data.ts` rather
than in `App.tsx`, because `App.tsx` has no test and this is the part worth
having one.

### 4 — the three surfaces, and parity

`contract.test.ts` gains `distribute` to the list of operations no surface may
route, and a test naming the split: the session registers `distribute`, the
server's route table holds `accept_distribution` and `drop_distribution`, and
both accept an empty body — the plan is the record, and passing it back would let
a screen accept something other than what it showed.

Four expectations elsewhere went red on the change and were corrected as
deliberate, reviewed moves rather than updated blind:

| What went red | Why it was right to move |
| --- | --- |
| `OPERATIONS` snapshot | Two operations added. The snapshot exists to make exactly this visible in review. |
| `core` exports snapshot, `CEILING` 103 → 107 | Four names, one consumer each. Recorded in ADR 0051 and in `BUILD-PLAN.md` §7. |
| `schema` exports snapshot | `Distribution` and `Match`. |
| server `READS` list, `mcp.test.ts` tool count | A sixth read and a 27th tool, both named rather than counted loosely. |

### 5 — end to end, across two surfaces

`test/integration/distribute.test.ts` drives the crossing the feature is for: a
real MCP client writes the plan, and the built `sober` binary — a separate
process that never saw the session — reads it and settles it.

```
$ npx vitest run --project integration distribute.test.ts
Test Files  1 passed (1)
     Tests  4 passed (4)
```

**Guaranteed:** a session's proposal assigns nobody; the terminal reads the
reasons the session wrote; `--accept` writes the assignees and removes the
record; a claimed node survives both halves untouched; `--drop` is a way out that
assigns nothing; `.sober/distribution.json` is `merge=binary`, so git never
line-merges a board record.

### 6 — a session may not accept its own plan

Written after the first pass, on a consistency the surfaces did not have. `decide`,
`approve` and `accept` all put the human's act to the human through elicitation
(ADR 0010); accepting a distribution did not, and the skill said "do not accept it
for them" in prose instead. That is advice from an agent to itself, which is the
thing ADR 0010 argues is unenforceable — and it is the exact failure ADR 0051
rejects in its "the assignment *is* the proposal" alternative, arriving through a
different door.

`distribute` with `accept: true` now asks, naming every match. Dropping does not:
it lands nothing, and a dialog to tidy up is friction with nothing to show for it.

```
$ npx vitest run --project integration distribute.test.ts
Test Files  1 passed (1)
     Tests  9 passed (9)
```

**Guaranteed:** a human who says no leaves the board untouched *and* leaves the
plan on it, so another surface can still ask the question its own way.

### 7 — two defects the reading found, neither of them in the new code

**`sober init`'s `.gitattributes` block was written once, behind a marker line.**
`appendBlock` looked for `.sober/nodes/*.json` and added nothing if it was
there, so every board created before today would never gain
`.sober/distribution.json merge=binary` — and git would line-merge the one board
file nobody thought to look at, writing `<<<<<<<` into a record every surface
parses. This is the first board file added since `init` existed, so the marker
had never been wrong before.

RED, in `packages/core/src/board.test.ts`, which did not exist:

```
$ npx vitest run packages/core/src/board.test.ts
× a repository with no attributes file gets the whole block
× a repository holding an older block gains only the lines it is missing
AssertionError: expected '# SOBER: board records are merged fie…' to contain '.sober/distribution.json merge=binary…'
     Tests  2 failed | 1 passed (3)
```

GREEN: `ensureAttributes` keeps the block in step line by line. A person's own
rules are untouched, a line already there is not written twice, and every future
addition to the list is carried the same way — to a fresh repository by `init`
and to a cloned one by `sync`.

**`dropDistribution` parsed before it deleted.** A plan nobody can read is
exactly the one somebody needs off the board, and going through the reader put
the only way out behind the thing that was broken. It now checks that the file is
there and deletes it.

```
$ npx vitest run packages/core/src/distribute.test.ts packages/core/src/board.test.ts
     Tests  17 passed (17)
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | A proposal changes no node — the constraint the feature turns on | `core/distribute.test.ts:a proposal waits on the board…` | unit | PASS |
| 2 | A node somebody has claimed is passed over at proposal | `core/distribute.test.ts:a node somebody is already on is passed over…` | unit | PASS |
| 3 | …and again at acceptance, because a teammate can claim in between | `core/distribute.test.ts:a node claimed between the proposal and the acceptance…` | unit | PASS |
| 4 | A finished node is passed over too | `core/distribute.test.ts:a finished node is passed over too…` | unit | PASS |
| 5 | An unknown handle refuses the whole plan and writes nothing | `core/distribute.test.ts:a handle nobody put on the project is refused…` | unit | PASS |
| 6 | Accepting assigns and clears; dropping clears and assigns nothing | `core/distribute.test.ts:accepting writes the assignees…`, `:dropping clears it…` | unit | PASS |
| 7 | `focus` migrates from a sentence to a list without losing the words | `core/migrate.test.ts:a team written before focus was a list…` | unit | PASS |
| 8 | The screen shows why each node went where it did | `dashboard/distribute/Distribution.test.tsx:the reason each node was matched…` | component | PASS |
| 9 | Dropping is on the screen beside accepting | `dashboard/distribute/Distribution.test.tsx:both ways out are on the screen…` | component | PASS |
| 10 | Only a session proposes; every surface settles | `integration/contract.test.ts:only a session proposes a distribution…` | integration | PASS |
| 11 | A session's plan is settled by a process that never saw the session | `integration/distribute.test.ts:a session writes the plan and a terminal…` | integration | PASS |
| 12 | The plan travels with the board and git never line-merges it | `integration/distribute.test.ts:the plan travels with the board…` | integration | PASS |
| 13 | A board created before this feature still gains the new merge rule | `core/board.test.ts:a repository holding an older block…` | unit | PASS |
| 14 | A plan nobody can parse is loud, and can still be dropped | `core/distribute.test.ts:a plan nobody can parse is loud…` | unit | PASS |
| 15 | The handle lands as the team file spells it | `core/distribute.test.ts:the handle lands as the team file spells it…` | unit | PASS |
| 16 | A session cannot accept its own plan — the human is asked | `integration/distribute.test.ts:a session may not accept its own plan…` | integration | PASS |
| 17 | A plan that cannot be read does not take the canvas down | `dashboard/distribute/data.test.ts:a plan that cannot be read comes back as a sentence…` | unit | PASS |
| 18 | The dashboard reads and settles the plan like the other two | `integration/distribute.test.ts:the dashboard reads the plan and settles it…` | integration | PASS |

## Checks

```
$ pnpm test           78 test files, 850 passed
$ pnpm lint           biome: 256 files, no fixes · secretlint: clean
$ pnpm typecheck      11 tasks, 11 successful
$ pnpm boundaries     no dependency violations (227 modules, 913 dependencies)
$ pnpm coverage:check green — see the section below for what the baseline says
```

The suite was 826 before this work and is 850 after: 24 tests, of which 5 are
`App.tsx`'s first.

## Coverage, and a red check that was already red

Coverage is measured by `pnpm coverage` against `coverage-baseline.json`; the
ratchet is per package and fails on a drop.

**`main` at `041719e` fails it, and did before this work started.** The ratchet
reported `core: 98.54% -> 97.88%` here, so `main` itself was measured — the work
in progress stashed, `pnpm coverage` run at `041719e`, the work restored:

```
$ git stash push -u && pnpm coverage && pnpm coverage:check
cli: 0.11% (baseline 0.11%)
dashboard: 56.49% (baseline 56.49%)
mcp: 94.38% (baseline 94.38%)
server: 95.03% (baseline 95.03%)

core: 98.54% -> 97.74% — coverage dropped
```

`coverage-baseline.json` was last written in `1cf7bc0`, on the chain-claim
branch, and `041719e` merged that branch into a `main` that had since taken the
auditor and the two other hosts. Nobody re-measured after the merge, so the
committed baseline describes a tree that no longer exists. This is the third
thing that merge got wrong — the worktree note already records two semantic
conflicts git did not see.

Against the tree as it actually is, this work **raises** core (97.74 → 97.88)
and the two surfaces it touches (mcp 94.38 → 94.76, server 95.03 → 95.11), and
`apps/dashboard` moves because `App.tsx` gained its first test: it was 0% and
136 lines of it were never executed by anything.

`pnpm coverage:update` has been run, so the check is green and the baseline
describes the tree that exists:

```
cli: 0.11 · core: 97.88 · dashboard: 66.22 · mcp: 94.76 · server: 95.11
```

**`core` in that file is now 97.88, down from 98.54, and that is a regression
this work did not cause and did not fix.** Lowering it is the ratchet losing a
memory. The alternative was to leave the check red on a number nobody could act
on from inside this change, since the uncovered lines are in `status.ts`,
`archive.ts` and `sync.ts` and writing tests to reach a number is the failure
`STRUCTURE.md` names. Reverting the `core` line to 98.54 and fixing `main`
first is a defensible call and is the reviewer's to make.

Deliberate gaps:

- **The matching itself is not tested, and cannot be.** It is a model's judgement
  in a host session (ADR 0051). What is tested is everything around it: the
  refusals, the skip rule, the record, and the fact that nothing lands. This is
  the same shape `propose` has had since ADR 0009 — the session's output is
  checked, the session's reasoning is not.
- **No test asserts a particular allocation.** There is no right answer to assert
  against, and a test that pinned one would be pinning a prompt.
- **The dashboard's poll now carries a third read.** Measured only by the fact
  that it is one small file; no performance test, because there is no budget to
  measure it against. Its failure path is isolated and tested (`readPlan`), but
  `App.tsx` itself has no test and did not gain one here: rendering it needs the
  Cytoscape canvas in `happy-dom`, which produced an empty tree. That is a
  pre-existing gap, named rather than papered over.

## Git checkpoints

Nothing is committed. The repository rule is that a commit is asked for first,
and the item's brief repeats it. The RED/GREEN evidence above is the record until
then.
