# v1.x item 4 — a plugin and an adapter for Codex and OpenCode

- Date: 2026-09-07
- Decision: ADR 0048
- Branch: `worktree-other-plugins`, from `main` at `a33956a`

No plan file. The journeys below were derived from `SCOPE.md`'s SHOULD row and from the four questions the work was told to surface before building; the answers to those four are recorded in ADR 0048 and are what this implements.

## What the user asked for, and what was built

| Asked | Answered |
| --- | --- |
| Which host, one or three? | Two: Codex and OpenCode. Cursor stays in SHOULD — no released headless shape to read flags off. |
| Plugin, adapter, or both? | Both, for each host. |
| What is the shared part? | One source plus a build step: `plugins/skills/` → `scripts/build-plugins.mjs` → three packages. |
| What happens where the host cannot elicit? | The host's own way of asking is the mechanism; where it has none, `decide` refuses and the agent puts the question in the conversation and waits. ADR 0010's rule is kept, its assumption dropped. |

## User journeys

1. As someone using Codex, I want the same board, decisions and review inside my session, so that I do not have to switch hosts to plan.
2. As someone using OpenCode, I want the same, and I want to be told plainly where this host cannot ask me a question, so that no decision is answered on my behalf.
3. As someone dispatching a node, I want to point `dispatch.host` at Codex or OpenCode and have the node actually run, commit, and read back as a run rather than as raw JSON.
4. As someone whose `dispatch.host` is none of the three, I want to be told before a worktree is cut, not three minutes later.
5. As a maintainer, I want the refusals in the loop skill to be one sentence in one place, so that three copies cannot drift.
6. As someone watching a run, I want a host that cannot be answered to say so rather than seat me in front of a session that cannot hear me.

## The recordings

Every flag and every event shape in `packages/core/src/hosts.ts` was read off the installed CLI here, on 2026-09-07 — never from memory (BUILD-PLAN §6).

```
$ codex --version
codex-cli 0.153.3
$ opencode --version
1.18.20
```

**Codex** — `codex exec --json --skip-git-repo-check --sandbox read-only 'Run ls …'`:

```jsonl
{"type":"thread.started","thread_id":"01a07d3d-0fee-7e70-ac4f-ea76f7f0bf68"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_1","type":"error","message":"Exceeded skills context budget. …"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"I'll check the directory."}}
{"type":"item.completed","item":{"id":"item_3","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"…","exit_code":0,"status":"completed"}}
{"type":"turn.completed","usage":{"input_tokens":46085,"output_tokens":73}}
```

Two things that are not guesses a reader would make, and both are in the code as comments: Codex reports its own complaints as `error` **items** rather than on stderr, and `codex exec` prints `Reading additional input from stdin...` and waits when stdin is a pipe nobody writes to — which is why `startAgent` closes it.

**OpenCode** — `opencode run --format json --auto 'Run ls …'`:

```jsonl
{"type":"step_start","part":{"type":"step-start"}}
{"type":"text","part":{"type":"text","text":"I'll run ls to list the files in this directory."}}
{"type":"tool_use","part":{"type":"tool","tool":"bash","callID":"…","state":{"status":"completed","input":{"command":"ls"},"output":"…"}}}
{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}
```

There is no event for the end of a **run**, only for the end of each step, so how a run ended is read from how the process exited. Rendering `step_finish` as a result would tell the person watching that the run finished several times.

**Readiness**, off the same CLIs:

```
$ codex login status
Logged in using ChatGPT
$ opencode providers list
┌  Credentials
│
●  OpenRouter  api
│
└  1 credentials
```

**The Codex plugin format**, verified by installing it rather than by reading about it:

```
$ codex plugin marketplace add <this repo>
Added marketplace `sober` from …
$ codex plugin add sober@sober
Added plugin `sober` from marketplace `sober`.
Installed plugin root: ~/.codex/plugins/cache/sober/sober/0.0.0
$ codex plugin list | grep sober@sober
sober@sober  installed, enabled  0.0.0  …/packages/codex-plugin
$ find ~/.codex/plugins/cache/sober/sober/0.0.0 -maxdepth 1
… /.mcp.json  … /skills  … /.codex-plugin
```

Then `codex plugin remove sober@sober` and `codex plugin marketplace remove sober`, so the machine is as it was.

## Task report

### 1. The adapter table (`hosts.ts`), and the log renderer that reads three shapes

RED first. `packages/core/src/hosts.test.ts` was written against a module that did not exist, and four tests appended to `packages/core/src/tail.test.ts` were written against a renderer that knew one host:

```
$ npx vitest run packages/core/src/hosts.test.ts packages/core/src/tail.test.ts
FAIL src/hosts.test.ts — Error: Cannot find module './hosts.js'
FAIL src/tail.test.ts > a Codex run renders its start, its message, its command and its end
  AssertionError: expected [] to deeply equal [ { kind: 'started', … } ]
Test Files  2 failed (2)
Tests  4 failed | 12 passed (16)
```

GREEN after `hosts.ts` and after `tail.ts` was cut down to "parse, then ask each adapter":

```
$ npx vitest run packages/core/src
Test Files  20 passed (20)
Tests  163 passed (163)
```

Two existing tests moved with it rather than being weakened. `host.test.ts` built its fakes as `host-3.mjs`, which SOBER now refuses because it cannot tell which host that is; they are `claude.mjs`, one per directory. `checkHost('sober-no-such-host')` became `checkHost('/nonexistent/bin/claude')` — "no adapter for this name" and "this host is not installed" are different refusals and the test wants the second.

### 2. A node dispatched to each host actually runs

RED: `test/integration/other-hosts.test.ts` against fakes recorded from the output above.

```
$ npx vitest run test/integration/other-hosts.test.ts
FAIL > codex cannot be attended, and says so instead of pretending
  AssertionError: promise resolved "{ run: 'auth-api-k7f2-xs50', … }" instead of rejecting
Tests  2 failed | 6 passed (8)
```

Six passed on the first run, which is the honest reading of it: the dispatch path was already host-shaped enough that the table alone made it work. The two that failed are the refusal that had not been written yet.

GREEN after `dispatch` learned to refuse an attended run on a host that cannot be attended:

```
$ npx vitest run test/integration/other-hosts.test.ts
Test Files  1 passed (1)
Tests  8 passed (8)
```

### 3. One source for the skills, and three plugins built from it

This step was built before its test, and the report says so rather than presenting it as RED-first. What was done instead is to prove the checks are not vacuous, by breaking each guarantee and watching it fail.

A generated file edited by hand:

```
$ printf '\nedited by hand\n' >> packages/codex-plugin/skills/loop/SKILL.md
$ npx vitest run test/integration/plugin.test.ts
AssertionError: packages/codex-plugin/skills/loop/SKILL.md is stale — run `pnpm plugins`
Tests  1 failed | 8 passed (9)
```

A host over-claiming enforcement it does not have (`cannot enforce it` → `enforces it everywhere` in `plugins/hosts/codex.json`):

```
$ npx vitest run test/integration/plugin.test.ts
× a host that cannot enforce the block says so, rather than claiming it can
AssertionError: codex: expected '---\ndescription: How SOBER's loop w…' to contain 'cannot enforce it'
```

Both restored, then:

```
$ npx vitest run test/integration/plugin.test.ts
Test Files  1 passed (1)
Tests  9 passed (9)
```

The generated Claude Code skills were diffed against what shipped, and the only differences are intended: the "do not edit" notice, the new sentence about how a decision reaches the human, and `/sober-decide` → `/sober:decide` in the loop skill, which was the one place still spelling the skill as ADR 0009's command.

## Test specification

| # | What is guaranteed | Test | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | The adapter is found in a command line, so `npx codex` and a full path both work | `packages/core/src/hosts.test.ts:the adapter is chosen from the host command` | unit | PASS |
| 2 | A host with no adapter is refused by name, with the three SOBER has | `hosts.test.ts:a host SOBER has no adapter for is refused by name` | unit | PASS |
| 3 | Every host's headless run is told nobody can answer it, flag or no flag | `hosts.test.ts:every adapter tells a headless run that nobody can answer it` | unit | PASS |
| 4 | The brief is an argument in every adapter, never a joined shell string | `hosts.test.ts:the brief is an argument, never a shell string` | unit | PASS |
| 5 | Only Claude Code reports itself attendable | `hosts.test.ts:only Claude Code can be attended` | unit | PASS |
| 6 | A login status no adapter can read is a refusal, never a silent pass | `hosts.test.ts:a status no adapter can read is a refusal` | unit | PASS |
| 7 | Codex and OpenCode logs render as lines, and one host's events are never read as another's | `packages/core/src/tail.test.ts` (4 tests) | unit | PASS |
| 8 | A node dispatched to Codex or OpenCode runs, records how it exited, and the brief plus `NO_HUMAN` reach it | `test/integration/other-hosts.test.ts:a node dispatched to … runs in its worktree` | integration | PASS |
| 9 | Those runs read back as rendered lines, not as raw JSON | `other-hosts.test.ts:a … run reads back as a run, not as raw JSON` | integration | PASS |
| 10 | A logged-out host is caught before a worktree exists | `other-hosts.test.ts:a logged-out … is caught before a worktree exists` | integration | PASS |
| 11 | An attended run on a host that cannot be attended is refused, with no half-started run left | `other-hosts.test.ts:… cannot be attended, and says so instead of pretending` | integration | PASS |
| 12 | Every host's manifest declares the server the CLI publishes, in that host's format | `test/integration/plugin.test.ts:every host declares the server the CLI publishes` | integration | PASS |
| 13 | What is on disk is what the source builds, for every host | `plugin.test.ts:what is on disk is what the source builds` | integration | PASS |
| 14 | The "What never happens" list is the same sentence in all three | `plugin.test.ts:the refusals are the same sentence in every host` | integration | PASS |
| 15 | A host that cannot enforce the block says so rather than claiming it can | `plugin.test.ts:a host that cannot enforce the block says so` | integration | PASS |
| 16 | Every host's decide skill carries the fallback for a host that cannot ask | `plugin.test.ts:where a host cannot put a question on screen` | integration | PASS |

## Coverage

```
$ npx vitest run
Test Files  71 passed (71)
Tests  757 passed (757)

$ node scripts/coverage-ratchet.mjs
cli: 0.12% (baseline 0.13%)
core: 97.68% (baseline 97.6%)
dashboard: 56.45% (baseline 56.45%)
mcp: 94.13% (baseline 94.13%)
server: 94.89% (baseline 94.89%)
exit=0
```

`core` rose; nothing else moved. Lint, secret scan, typecheck and boundaries are clean.

## Known gaps

- **No live host session drove the loop.** The dispatch tests use fakes (ADR 0014) built from the recordings above. What is proven is that SOBER builds the right invocation, reads the right events and records the right run; what is not proven is that a live Codex or OpenCode session plans and reviews well through the MCP server. That is a gate, and it has not been run.
- **The Codex plugin was installed for real; the OpenCode one was not.** OpenCode's install is copying two paths into a config directory, so there is no installer to verify — but nothing here proves OpenCode loads these skills in a live session.
- **No hook enforcement and no attended dispatch on the new hosts.** Deliberate, and both stay in `SCOPE.md`'s SHOULD list with the reason attached (ADR 0048).
- **Cursor was not built.** Its headless invocation has no released shape to read flags off here, and writing one from memory is what BUILD-PLAN §6 forbids.
- **`opencode providers list` is parsed by counting credentials.** It is the only readiness surface the CLI offers and it is prose, not JSON. A release that reworded the box would read as "cannot report its status", which is a refusal rather than a silent pass — the failure mode this was chosen for.
