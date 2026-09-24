# TDD evidence — chain claim (v1.x item 2)

- Date: 2026-09-08
- Branch: `main`, on top of `08b8127`
- ADR: `docs/adr/0050-a-run-of-linked-nodes-is-claimed-by-its-two-ends.md`
- Source plan: none. The journeys below come from the item's brief, ADR 0005, ADR 0025 and ADR 0032.

## What the four questions settled

The item shipped with four open questions and an instruction not to settle them
alone. All four went to the human before any code was written, and the first one
came back not as a choice but as a description — "a group of nodes bound to each
other, most likely around one feature or one component; there has to be an edge".

That description was measured before it was built. `Node` holds no grouping
field, so "a feature" exists only in the edges — and an undirected walk from any
node on a board where two features hang off one shared foundation returns the
whole board, because the foundation joins every feature to every other one. The
finding went back with the board drawn out, and the answer was **the path
between two named ends**.

| Question | Answer |
| --- | --- |
| What a chain is | The run between two named nodes, `from..to` |
| Part of it already taken | Refuse the whole run, `--anyway` is the confirmation |
| Whether it survives a sync | A snapshot — no record says these were a run |
| Whether releasing is one act | Yes, and it never touches somebody else's node |

## User journeys

1. As a contributor who has planned a run of five linked nodes, I take all five in one command, so a teammate cannot take the third one while I am still on the second.
2. As that contributor, taking the run never takes the shared foundation everybody else is waiting on — I named the two ends of my work, not the whole board.
3. As a teammate, my node inside somebody's run is never taken silently: they are refused once with my name on the screen, and the second command is them saying they meant it.
4. As the person giving a run back, one command returns all of it, and a node that is not mine is left exactly where it was.
5. As anyone reading the board, a run leaves nothing behind that a claim does not already leave — no new record, no new status, nothing to disagree with the graph.
6. As someone on any of the three surfaces, `from..to` means the same thing, because one parser reads it.

## RED

Written first, all four files, before any of `chainEnds`, `between`,
`claimChain` or `releaseChain` existed.

```
$ npx vitest run packages/schema/src/id.test.ts packages/core/src/graph.test.ts packages/core/src/team.test.ts

 Test Files  3 failed (3)
      Tests  19 failed | 28 passed (47)

$ npx vitest run packages/core/src/graph.test.ts packages/core/src/team.test.ts 2>&1 | grep -E "^TypeError" | sort | uniq -c
   6 TypeError: between is not a function
  10 TypeError: claimChain is not a function
```

Nineteen failures, every one of them the intended business logic being absent —
six for the graph walk, ten for the two writes, three for the parser. No unrelated
breakage, no failure from setup or syntax.

## GREEN

```
$ npx vitest run packages/core/src/graph.test.ts      # 13 passed
$ npx vitest run packages/core/src/team.test.ts       # 26 passed
$ npx vitest run --project integration contract.test.ts   # 9 passed
```

The full run stopped on exactly the two guards it was supposed to stop on:

```
$ npx vitest run
 Snapshots  2 failed
 Test Files  2 failed | 70 passed (72)
      Tests  2 failed | 790 passed (792)

+   "chainEnds"      (schema surface snapshot)
+   "claimChain"     (core surface snapshot)
+   "releaseChain"
```

Three names, no fourth. `between` is not among them: it is called by `team.ts`
and never exported from the barrel, because a surface must use the function that
takes the lock, not the walk on its own. The ceiling moved from 101 to 103 by
ADR 0028's rule, and the snapshots were updated after being read.

```
$ npx vitest run                       # 72 files, 798 passed
$ npx vitest run --project integration # 27 files, 349 passed
```

## Driven by hand, on all three surfaces

Tests say the record is right. These say a person can read what happened.

**The command line**, on a board of `db-setup ← auth-schema ← auth-api ← auth-ui`
with `billing-api` hanging off the same foundation:

```
$ sober claim auth-schema-ocpm..auth-ui-cyyx
✓ 3 nodes are yours, as alice
  auth-schema-ocpm
  auth-api-mmqo
  auth-ui-cyyx

$ sober status | tail -5
  blocked      auth-api-mmqo     auth api     @alice  waiting on auth-schema-ocpm
  blocked      auth-schema-ocpm  auth schema  @alice  waiting on db-setup-ur8i
  blocked      auth-ui-cyyx      auth ui      @alice  waiting on auth-api-mmqo
  blocked      billing-api-xex7  billing api          waiting on db-setup-ur8i
  needs-brief  db-setup-ur8i     db setup
```

The shared foundation and the other feature are untouched, which is the whole
of the first decision.

```
$ sober claim auth-schema-ocpm..auth-ui-cyyx      # bob is on the middle
· 1 of 3 nodes is already someone else's
  auth-api-mmqo  bob

  Nothing was taken. `--anyway` takes the whole run.

$ sober release auth-schema-ocpm..auth-ui-cyyx    # bob back on the middle
✓ 2 nodes are nobody's again
  auth-schema-ocpm
  auth-ui-cyyx

· left alone, because they are not yours
  auth-api-mmqo  bob

$ sober claim auth-ui-cyyx..auth-schema-ocpm      # the ends the wrong way round
· nothing links auth-ui-cyyx to auth-schema-ocpm — no run to take

  A run reads from the node the work starts at to the one it ends at.
```

**The host session**, driven through a real `tools/call`:

```
taken:     auth-schema-dr1f, auth-api-t3hr, auth-ui-3gov are alice's.
released:  auth-schema-dr1f, auth-api-t3hr, auth-ui-3gov are nobody's again.
one node:  auth-api-t3hr is alice's.
no path:   Nothing links auth-ui-3gov to auth-schema-dr1f, so there is no run to
           take. A run reads from the node the work starts at to the one it ends at.
refused:   this host cannot put a question to you, so it cannot take a run that
           crosses somebody else's node. Answer it on the command line instead —
           the board is the same one.
```

**The dashboard**, through `OPS.claim.run` and `OPS.release.run` directly:

```
{"nodes":[…3…],"changed":[],"taken":[{"id":"auth-api-t3hr","by":"bob"}],"done":[]}
{"nodes":[…3…],"changed":[…3…],"taken":[{"id":"auth-api-t3hr","by":"bob"}],"done":[]}   # anyway: true
OPS.claim.run(paths, { node: 'not an id..either' })  →  refused: ZodError
```

## What each test guarantees

| # | What is guaranteed | Test | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | `from..to` reads as two ids, and one id alone does not | `packages/schema/src/id.test.ts` | unit | PASS |
| 2 | Half a run, and a third end, are not runs | `id.test.ts` | unit | PASS |
| 3 | An end that is not a valid id is not an end | `id.test.ts` | unit | PASS |
| 4 | The run is what lies between the ends — not the shared foundation either end merely touches | `packages/core/src/graph.test.ts` | unit | PASS |
| 5 | Every path is the run: a diamond leaves neither side out | `graph.test.ts` | unit | PASS |
| 6 | The run reads in dependency order, the order the work happens in | `graph.test.ts` | unit | PASS |
| 7 | A run of one is a run — the two ends may be the same node | `graph.test.ts` | unit | PASS |
| 8 | The ends are given dependency-first; backwards is no run at all | `graph.test.ts` | unit | PASS |
| 9 | Two unconnected nodes are no run, and neither is an end off the board | `graph.test.ts` | unit | PASS |
| 10 | Taking the whole run is one act, and it stops at the ends it was given | `packages/core/src/team.test.ts` | unit | PASS |
| 11 | One act is one moment: every node in the run carries the same timestamp | `team.test.ts` | unit | PASS |
| 12 | A run whose middle is someone else's is refused whole and writes nothing | `team.test.ts` | unit | PASS |
| 13 | `anyway` is the confirmation, and it still reports whose the node was | `team.test.ts` | unit | PASS |
| 14 | My own node is not somebody else's, whatever case the handle was written in | `team.test.ts` | unit | PASS |
| 15 | A finished node inside the run is passed over, never re-claimed | `team.test.ts` | unit | PASS |
| 16 | Giving a run back is one act, and a teammate's node is left where it was | `team.test.ts` | unit | PASS |
| 17 | A claim is a snapshot: a node that lands in the run later is nobody's | `team.test.ts` | unit | PASS |
| 18 | Two ends with nothing between them take nothing and say so | `team.test.ts` | unit | PASS |
| 19 | An end the board does not hold is refused, the way one node is | `team.test.ts` | unit | PASS |
| 20 | The run is reachable on the command line, in a session and on the dashboard | `test/integration/contract.test.ts` | integration | PASS |
| 21 | All three surfaces read `from..to` with the same parser, so they cannot drift | `contract.test.ts` | integration | PASS |
| 22 | From the terminal: the run is taken, the shared foundation is not, and `sober status` agrees | `test/integration/cli.test.ts` | integration | PASS |
| 23 | In a session: a run is taken and given back through a real `tools/call` | `test/integration/mcp.test.ts` | integration | PASS |
| 24 | In a session: two ends with nothing between them are said so, not answered with silence | `mcp.test.ts` | integration | PASS |
| 25 | In a session: a run crossing a teammate's node asks **once**, and yes takes all of it | `mcp.test.ts` | integration | PASS |
| 26 | In a session: a human who says no leaves every node exactly where it was | `mcp.test.ts` | integration | PASS |
| 27 | In a session: giving a run back never takes a teammate's node off them | `mcp.test.ts` | integration | PASS |

Tests 20 and 21 are the parity half. They exist because a run is **not** a new
operation — it is `claim` and `release` over a set — so `OPERATIONS` does not
grow and `PR-09-08`'s existing checks stay green whether or not any surface has
it. Without these two, a run on the command line and nothing in the session
would have been a silent parity break.

Tests 22–27 were written **after** the first coverage run, not before, and that
is the one place this change departed from RED-first. The coverage ratchet went
red on `mcp` — 94.13% → 91.25% — because the session's half was proved by hand
and by nothing else. Test 22 found a real defect in its own first run: switching
the git identity mid-test made all three nodes read as somebody else's, which is
the takeover reporting working correctly on a test that was wrong.

## Coverage

```
$ node scripts/coverage-ratchet.mjs
cli: 0.11% (baseline 0.11%)
core: 98.54% (baseline 98.54%)
dashboard: 56.49% (baseline 56.49%)
mcp: 94.38% (baseline 94.38%)
server: 95.03% (baseline 95.03%)
```

Four of the five rose: `core` 97.6 → 98.54, `mcp` 94.13 → 94.38, `server`
94.89 → 95.03, `dashboard` 56.45 → 56.49. `coverage-baseline.json` is refreshed
in this commit, which is what raises the floor under all four.

`cli` fell, 0.13% → 0.11%, past the ratchet's 0.01 tolerance. It is the
structural artefact this package has always had and the auditor's report named:
the CLI is exercised through a **spawned binary**, so none of its source
attributes, and adding ~110 covered lines to `packages/cli/src/team.ts`
mechanically lowers a number that is 0.1% either way. The behaviour those lines
carry is test 22, driven end to end through the built `sober`.

## Other checks

```
$ npx biome check .                                        # clean, 244 files
$ npx secretlint --secretlintignore .gitignore "**/*"      # clean
$ npx tsc --noEmit -p tsconfig.json && npx turbo run typecheck   # 11 tasks, clean
$ npx depcruise apps packages test --config .dependency-cruiser.cjs
  ✔ no dependency violations found (216 modules, 852 dependencies cruised)
```

## Known gaps

- **The same-files warning does not fire on a run.** Deliberate, and argued in
  the ADR: a run's members share files by construction, so warning on every pair
  is noise. The load-bearing check is untouched — `run` still refuses per node at
  dispatch (ADR 0032).
- **`pnpm demo:team` does not show a run.** Its board is three nodes with no
  edges between them, so any run command there prints "nothing links". Adding one
  would mean changing the fixture the rest of that walkthrough narrates, for a
  hand-driven aid rather than a check. Named rather than done.
- **The dashboard has the route, not a button.** That is how `claim` and
  `release` have always been on that surface — `SERVER_COVERS` is the route
  table, and the React app renders a claim without offering to make one. A run is
  reachable exactly as far as a single claim is.
- **A pre-existing message wart, left alone.** `NoElicitationError` interpolates
  its argument into "…so it cannot ${what}", and `build.ts` and `review.ts` both
  pass a question rather than a phrase, producing "so it cannot Start X anyway?."
  This change passes a phrase, matching `plan.ts`, which is the caller that reads
  correctly. Fixing the other two changes two other features' error text with no
  test covering it, so it is reported here instead.
