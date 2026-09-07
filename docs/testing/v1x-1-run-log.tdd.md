# v1.x-1 — the run log on the screen, and answering a run

- Date: 2026-09-07
- Branch: `worktree-run-log` (fast-forwarded onto `main` at `ef1d094` before any
  work — the worktree had been cut at `5514eb9`, 83 commits behind)
- Plan: v1.x item 1 of six. The specification is **ADR 0045**, which named this
  work and priced it; the record that closes it is **ADR 0046**.
- Decisions settled first: **ADR 0046**, and `SCOPE.md`'s SHOULD line moved to
  MUST #14 under the scope rule.
- Runner: `pnpm test` (turbo build, then vitest). Coverage: `pnpm coverage` then
  `pnpm coverage:check`.

## What the forks were, and what they were answered with

Four were put to the human before any code, as ADR 0045 required:

1. **What is being built.** Three options were offered — a refreshing record, a
   true live tail, or the whole SHOULD line including answering the agent. The
   answer was **the whole line**: live tail *and* answering, with attended
   dispatch as a second mode so the M2 gate's finding-1 fix keeps protecting
   every unwatched run.
2. **Transport.** Left to the implementation ("if it's the most stable and
   effective way"). Answered **streaming `fetch`, not `EventSource`** — see
   below; it is the finding that changed the price the ADRs had quoted.
3. **Where it renders.** **A screen of its own.** The panel is 420px (ADR 0041)
   and a run log is the longest reading in the product.
4. **What it costs while nobody is watching.** **Only while the log is open, and
   tail-bounded.** The channel is opened by the screen and closed when it
   unmounts.

Two findings changed the shape of the work and were surfaced rather than
absorbed:

- **`EventSource` is not the only push shape.** ADR 0036 and ADR 0045 both
  priced this at moving the loopback token into the URL. That is
  `EventSource`'s price: a streaming `fetch` sets `Authorization`. **ADR 0008's
  token exception is not spent.**
- **The dispatched agent could not be prompted at all.** `host.ts` closes stdin,
  passes `bypassPermissions`, and ships `NO_HUMAN` — the M2 gate's finding-1
  fix. "Answering its prompts" was therefore not a layer on top of dispatch but
  the inverse of it, and this was put back to the human before any code was
  written. The answer was a second, opt-in mode.

Two questions were answered from the host itself rather than from memory, as
`BUILD-PLAN` §6 requires. One real `claude` invocation
(`--input-format stream-json --replay-user-messages`) established that a
`{"type":"user",…}` line on stdin is accepted and answered, that the user
message is echoed back on stdout, and — the load-bearing one — that **the
session does not exit until stdin closes**. That last fact is why `answer`
carries a `done` flag.

## User journeys

1. As someone watching a node build, I want to read what the agent is saying
   without leaving the dashboard for a terminal.
2. As that person, I want the log to still be there after the run ends, and
   after I close and reopen the tab — ADR 0037's promise about the run, applied
   to what it said.
3. As that person, I want to answer the agent when it asks me something, and to
   see my own answer in the transcript.
4. As that person, I want to end the conversation cleanly rather than killing
   the session.
5. As someone on the command line, I want the same ability, because
   `sober run --watch` is holding my first terminal.
6. As the person who owns the queue, I want none of this to change what an
   unwatched run is told — the M2 gate's finding 1 must stay fixed.
7. As a reader of the transcript later, I want to tell who said what.

## RED, then GREEN

| # | Stage | Command | Result |
| --- | --- | --- | --- |
| 1 | RED | `npx vitest run packages/core/src/tail.test.ts` | `7 failed \| 1 passed` — `TypeError: followRun is not a function`. The one pass is `tail` itself, which already existed. |
| 1 | GREEN | same | `8 passed` |
| 2 | RED | `npx vitest run test/integration/watch.test.ts packages/server/src/routes.test.ts` | 9 integration failures + the contract tests; `Cannot convert undefined or null to object` on `WATCHES`, and `404` where `401`/`405`/`409` were expected |
| 2 | GREEN | same | `48 passed` |
| 3 | RED | `npx vitest run apps/dashboard/src/wire.test.ts apps/dashboard/src/panel/data.test.ts` | `7 failed` — `wire(...).watch is not a function`, and the panel still pointing at `sober logs` |
| 3 | GREEN | same | `42 passed` |
| 4 | RED | `npx vitest run test/integration/attended.test.ts` | `6 failed` — `answerRun` undefined, `ATTENDED_ARGS` undefined |
| 4 | GREEN | same | `8 passed` |
| 5 | RED | `npx vitest run` (after adding `answer` to `OPERATIONS`) | `8 failed` — the three-surface contract test refusing an operation the CLI, session and dashboard did not yet cover |
| 5 | GREEN | same | `727 passed (69 files)` |

Two RED stages were caused by my own test being wrong rather than by the code,
and both are recorded here rather than quietly fixed:

- The attended tests asserted a **404** for "that node has not run yet".
  `serve.ts` states the rule — a refusal the product meant is a **409** — so the
  test was corrected to the codebase's rule, not the code to the test.
- One test let a headless run *finish* and then expected a "nothing is
  listening" refusal. The honest first refusal is "it is not running", so the
  test was split into the two real cases: a finished run, and a live headless
  one.

## Test specification

| # | What is guaranteed | Test file | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | A window on a fresh log starts at the top and reports where to resume | `packages/core/src/tail.test.ts` | unit | PASS |
| 2 | Asking again from an offset returns only what arrived since | `packages/core/src/tail.test.ts` | unit | PASS |
| 3 | A half-written line is left for the next read, never parsed in pieces | `packages/core/src/tail.test.ts` | unit | PASS |
| 4 | The first window is bounded, so opening a long run does not send the whole file | `packages/core/src/tail.test.ts` | unit | PASS |
| 5 | A finished run reports `live: false`, and its log still reads back | `packages/core/src/tail.test.ts` | unit | PASS |
| 6 | A run with no log yet reads as empty, never as an error | `packages/core/src/tail.test.ts` | unit | PASS |
| 7 | A person reads a run over the wire with no terminal | `test/integration/watch.test.ts` | integration | PASS |
| 8 | A line written mid-watch reaches the reader with no second request | `test/integration/watch.test.ts` | integration | PASS |
| 9 | A watcher who leaves stops the reads behind them | `test/integration/watch.test.ts` | integration | PASS |
| 10 | The log outlives the run, so reopening a tab finds it | `test/integration/watch.test.ts` | integration | PASS |
| 11 | A watch on a finished run closes itself rather than holding the connection | `test/integration/watch.test.ts` | integration | PASS |
| 12 | A node that has never run is refused with 409 and a sentence | `test/integration/watch.test.ts` | integration | PASS |
| 13 | A watch without a token is refused, like every other route | `test/integration/watch.test.ts` | integration | PASS |
| 14 | `POST /op/answer` reaches a watched run; a finished one is a 409 | `test/integration/watch.test.ts` | integration | PASS |
| 15 | `WATCHES` is exactly `logs`, and `READS` gains no sixth entry | `packages/server/src/routes.test.ts` | unit | PASS |
| 16 | A watch is never spelled like an operation or a read | `packages/server/src/routes.test.ts` | unit | PASS |
| 17 | A watch query that is not its shape is refused before `core` sees it | `packages/server/src/routes.test.ts` | unit | PASS |
| 18 | The client sends the token as a **header**, and never in the URL | `apps/dashboard/src/wire.test.ts` | unit | PASS |
| 19 | A window split across two TCP chunks is one window, not two broken ones | `apps/dashboard/src/wire.test.ts` | unit | PASS |
| 20 | Each window is handed over as it lands, not all at the end | `apps/dashboard/src/wire.test.ts` | unit | PASS |
| 21 | A running node offers its log beside Stop; a finished one still offers it | `apps/dashboard/src/panel/data.test.ts` | unit | PASS |
| 22 | A node that has never run offers no log to open | `apps/dashboard/src/panel/data.test.ts` | unit | PASS |
| 23 | The panel stops pointing at a terminal | `apps/dashboard/src/panel/data.test.ts` | unit | PASS |
| 24 | A ready node offers both ways to start, with the plain one first | `apps/dashboard/src/panel/data.test.ts` | unit | PASS |
| 25 | The screen renders what the agent said, and appends across windows | `apps/dashboard/src/logs/Logs.test.tsx` | unit | PASS |
| 26 | A live run can be answered; a finished one shows no box at all | `apps/dashboard/src/logs/Logs.test.tsx` | unit | PASS |
| 27 | "Send & finish" is a different act from "Send" on the wire | `apps/dashboard/src/logs/Logs.test.tsx` | unit | PASS |
| 28 | A refused answer says why and keeps what was typed | `apps/dashboard/src/logs/Logs.test.tsx` | unit | PASS |
| 29 | Enter sends, Shift+Enter does not, empty is never sent | `apps/dashboard/src/logs/Logs.test.tsx` | unit | PASS |
| 30 | Every line kind has a mark and a colour, and stderr does not read like output | `apps/dashboard/src/logs/data.test.ts` | unit | PASS |
| 31 | **A headless dispatch still tells the agent nobody is there** (M2 finding 1) | `test/integration/attended.test.ts` | integration | PASS |
| 32 | An attended dispatch says a human is there, and keeps `bypassPermissions` | `test/integration/attended.test.ts` | integration | PASS |
| 33 | A watched run can be answered, and both halves land in the log | `test/integration/attended.test.ts` | integration | PASS |
| 34 | The human's words are marked as theirs, not as the agent talking | `test/integration/attended.test.ts` | integration | PASS |
| 35 | The run record says whether anyone was watching | `test/integration/attended.test.ts` | integration | PASS |
| 36 | A run that has ended, and a live headless one, are each refused for their own reason | `test/integration/attended.test.ts` | integration | PASS |
| 37 | A run record written before `attended` existed still parses | `packages/schema/src/run.test.ts` | unit | PASS |
| 38 | `answer` reaches all three surfaces, or the contract test fails | `test/integration/contract.test.ts`, `test/integration/mcp.test.ts` | integration | PASS |

## The gate

```
pnpm test          69 files, 727 tests passed   (was 667 at ef1d094)
pnpm lint          clean
tsc --noEmit       clean
turbo typecheck    11/11
pnpm boundaries    no violations (208 modules, 805 dependencies)
pnpm coverage:check
    cli 0.13 (=)  core 97.6 (+0.11)  dashboard 56.45 (+3.41)
    mcp 94.13 (+0.05)  server 94.89 (+0.56)
```

Every package is at or above its baseline; `coverage-baseline.json` was updated
with `pnpm coverage:update`.

`core`'s barrel is at **100 of 100** (ADR 0028): `followRun` and `answerRun`.
The ceiling was met, not raised — the next name to go in needs an ADR.

## Known gaps, stated rather than left to be found

- **Tool-permission prompts are not answerable.** They travel by a control
  protocol to an SDK host, not as messages. Recorded on `SCOPE.md`'s SHOULD list
  as its own line (ADR 0046).
- **The channel does not reconnect.** The `offset` is carried for it and unused.
  The server's lifetime is `sober dashboard`'s (ADR 0037), so a dropped channel
  means the command stopped; reconnecting to a gone process is a spinner instead
  of a sentence.
- **An attended run left alone waits** until `stop` or the dispatch timeout.
  This is why "Run and watch" is a second button rather than what "Run" does.
- **No hand-driven gate for this item.** Every test above is automated. The real
  `claude` invocation was exercised once by hand to record the protocol, as
  `BUILD-PLAN` §6 requires, but a v1.x item has no gate script of its own.
- **`cli` coverage is 0.13% and unchanged.** `sober say` and `run --watch` are
  covered through `core` and the contract test, not through the CLI's own
  surface — the same position every other CLI command is in.
