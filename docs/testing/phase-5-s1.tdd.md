# S1 — the contract and the server, no screen

- Date: 2026-09-06
- Branch: `phase-5-dashboard`, 15 commits
- Source plan: no `*.plan.md`. The journeys come from `BUILD-PLAN.md` §2's M3
  scope and the four ADRs accepted at the head of this phase — 0035, 0036,
  0037, 0038
- Runner: `pnpm` + Vitest 4. `pnpm test`, `pnpm coverage`, `pnpm boundaries`

## User journeys

1. As someone who plans in a session and builds in a terminal, I want the
   dashboard to reach every operation the other two surfaces reach, so that
   choosing a screen never costs me an ability (`PR-09-08`).
2. As the operator, I want the board served on my own machine and nowhere else,
   so that opening the dashboard does not put my repository on the network
   (ADR 0008).
3. As the operator, I want closing a browser tab to stop nothing, so that a
   dispatch I started from the screen is not tied to a window (ADR 0037).
4. As the canvas, I want a projection rather than records, so that two hundred
   nodes is a payload rather than two hundred briefs (ADR 0008, 0016).
5. As a reviewer, I want a surface's claim about what it covers to be checked
   against the surface, so that parity is a test rather than a promise.

## The cycles

Seven, each RED before GREEN, each with its checkpoint commit on this branch.

| # | RED | GREEN | What it added |
| --- | --- | --- | --- |
| 1 | `5d3bf80` | `87ff83f` | The operation catalogue in `schema` |
| 2 | `d74b749` | `ee3eaac` | `ProjectedNode`, `Projection`, `WireError` |
| 3 | `df49e97` | `83d8d71` | `packages/server`'s route table |
| 4 | `28778bb` | `7a2d4a2` | `serve` — loopback, token, one error path |
| 5 | `dd764b3` | `79588bf` | `sober dashboard`, in the foreground |
| 6 | `7ffdcf5` | `5113d83` | The two manifests, and `PR-09-08` as a check |
| 7 | `e5ef11c`'s parent | `e5ef11c` | The ratchets, and the boundary rule that never fired |

Every RED was compiled and executed, and each failed for its intended reason.
Two failed first for an unintended one and were corrected before the cycle
continued, which is recorded here because it is the difference between a RED
gate and a red screen:

- Cycle 3's first run failed on a missing workspace link, not on the missing
  module. `pnpm install`, then the reason was right.
- Cycle 6's first run failed on a missing Vitest alias for `schema` and
  `server`. The config gained them, then the reason was right.

## What is guaranteed

| # | What is guaranteed | Where | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | The catalogue names every state-changing operation once, and reads are not in it | `packages/schema/src/operation.test.ts` | unit | PASS |
| 2 | What an agent authors is a separate list — a terminal has no agent | same | unit | PASS |
| 3 | A projection refuses five named heavy fields, so a record cannot be sent in its place | `packages/schema/src/wire.test.ts` | unit | PASS |
| 4 | A failure body carries a non-empty message and nothing else | same | unit | PASS |
| 5 | Every catalogued operation has a route, and no route exists that the catalogue does not name | `packages/server/src/routes.test.ts` | unit | PASS |
| 6 | Every one of the 17 routes and 3 reads refuses a body that is not its shape | same | unit | PASS |
| 7 | The server listens on `127.0.0.1` only, with a 64-character token | `packages/server/src/serve.test.ts` | unit | PASS |
| 8 | A wrong token of the right length is refused (the comparison does not leak on length) | same | unit | PASS |
| 9 | A request arriving under another hostname is refused whatever its token | same | unit | PASS |
| 10 | Operations are POST, reads are GET, and the wrong verb is a 405 | same | unit | PASS |
| 11 | A body over 1 MB is refused rather than buffered | same | unit | PASS |
| 12 | A refusal core meant is a 409; a parse failure is a 400; nothing else pretends to be either | same + `test/integration/wire.test.ts` | unit + integration | PASS |
| 13 | `sober dashboard` prints a loopback address and a token and does not exit | `test/integration/dashboard.test.ts` | integration | PASS |
| 14 | What it printed is what serves the board, and no other token works | same | integration | PASS |
| 15 | SIGINT stops it, and the address stops answering | same | integration | PASS |
| 16 | All three surfaces cover the catalogue exactly | `test/integration/contract.test.ts` | integration | PASS |
| 17 | Every command the CLI claims appears in `sober --help` | same | integration | PASS |
| 18 | Every tool the session claims appears in a real `tools/list` | same | integration | PASS |
| 19 | An operation done on the wire is seen by the command line, and the reverse | `test/integration/wire.test.ts` | integration | PASS |
| 20 | Every route reaches core rather than dying in its own wrapper | same | integration | PASS |
| 21 | A module outside `core` that imports `node:fs` fails `pnpm boundaries` | `test/integration/ratchets.test.ts` | integration | PASS |
| 22 | Every source directory that exists is one `pnpm boundaries` reads | same | integration | PASS |

Commands actually run, and their results:

```
pnpm vitest run                 48 files, 457 tests, all passing (105s)
pnpm vitest run --coverage      server 88.79% lines, core 97.43%, mcp 93.78%
node scripts/coverage-ratchet.mjs --update
                                { cli: 0.15, core: 97.43, mcp: 93.78, server: 88.79 }
npx depcruise packages test     no violations (152 modules, 600 dependencies)
npx biome check .               170 files, clean
npx tsc --noEmit                clean, root and every package
```

## What S1 found

Five defects, none of them in code written this session except the one marked.

1. **`only-core-touches-the-machine` had never fired.** It matched
   `^node:(fs|child_process)`; dependency-cruiser strips the prefix before
   matching, so a probe importing `node:fs` resolves to `fs` and the rule saw
   nothing. Live since phase 0. The rule is fixed and a probe test keeps it
   honest.
2. **`pnpm boundaries` reads `packages` and `test` only**, so ADR 0008's
   `dashboard-is-browser-only` is aimed at a directory the command never
   visits. Not fixable in S1 — an empty `apps/dashboard` is a source directory
   with no tests and the coverage ratchet would fail on a stub — so it is a
   test that goes red the day `apps/` appears. **Carried to S2.**
3. **`rejectWork` wrote a feedback record for a node that does not exist.** The
   CLI never reached it because `widen` refuses an unknown id first: the guard
   was in the surface rather than in the operation. Fixed in `core`, where one
   line covers every caller.
4. **`accept`'s route threw a plain `Error`** — written in this session — so a
   refusal the product means was reported as a 500. It throws `NotOnBoardError`
   now.
5. **`route.run` returned the inner promise**, so a parse failure threw
   synchronously past a caller's `.catch`. Also this session, caught while the
   tests were red.

## Known gaps

- **`routes.ts` is at 74% lines.** What is uncovered is the far side of the
  handlers that need a dispatch to reach — `run`, `sync`, `resolve`, `accept`
  past its review, `write_brief`. They are one-line calls into `core`, which is
  at 97.4%, and the residual risk is a swapped argument on a call whose
  parameters share a type. S4 drives them through the screen.
- **`cli` is at 0.15%** and was before this session. The CLI is covered by
  integration tests running the built binary, which the coverage instrument
  does not see; the ratchet holds it where it is rather than pretending
  otherwise.
- **A manifest can still lie about *how* it covers an operation.** The checks
  prove the command and the tool exist, not that `contributors` performs both
  `contributors_add` and `contributors_remove`. Making that a test means
  running each operation on each surface, which is the M3 gate's job.
- **sigma.js was never measured** (ADR 0038). If Cytoscape disappoints in S2
  there is no comparison to fall back on.

## Merge evidence

These fifteen commits are the RED/GREEN record. If they are squashed, this file
is the surviving proof: every guarantee above names the file that holds it, and
every command above was run.
