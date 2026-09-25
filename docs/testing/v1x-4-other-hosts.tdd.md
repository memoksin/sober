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

## Cline (ADR 0066)

- Date: 2026-09-25
- Branch: `sober/cline-host-pq8z`

No live `cline` binary on the machine this was built on. Every citation below is either the **published reference** at `docs.cline.bot` (fetched as raw Markdown via its `.md` suffix, which Mintlify serves unrendered) or the **installed npm source**, read through `gh api`/`gh search code` against `cline/cline` — never from memory (BUILD-PLAN §6). Where the two disagreed, the source won, and the disagreement is recorded rather than silently resolved.

```
$ npm view cline version
3.0.65
$ npm view cline dist-tags
{ nightly: '3.0.65-nightly.1790252460', latest: '3.0.65' }
```

`apps/cli/package.json` on `cline/cline`'s `main` branch reports the same `3.0.65` — the source read below is the version on npm, not an ahead-of-release snapshot.

**The flags** — `docs.cline.bot/cli/cli-reference.md`, "Help Menu (Source of Truth)":

```
Usage: cline [options] [command] [prompt]
  --json                       Output messages as JSON instead of styled text
  --auto-approve <boolean>     Set tool auto-approval for all tools (default: true)
  -s, --system <system-prompt> Override the default system prompt
Commands:
  auth [options] [provider]    Authenticate a provider and configure what model is used
  config [options]             Show current configuration
  doctor                       Diagnose and fix configuration issues
```

The upstream `apps/cli/README.md` (raw, `main`) documents a newer flag set the published reference does not yet show — `--yolo`, `--compaction`, `--team-name`, `--kanban` — which is named here rather than used: the reference is the one the node asked to be verified against, and `--auto-approve true` already gets the same headless guarantee `--yolo` would.

**The event shape — the reference is stale, the source is not.** `docs.cline.bot` documents `{"type": "say"|"ask", "text", "ts", "say", "ask", "partial"}`. The installed CLI does not emit it:

```
$ gh api /repos/cline/cline/contents/apps/cli/src/utils/events.ts
  emitJsonLine("stdout", { type: "agent_event", event })   # handleEvent, json branch
$ gh api /repos/cline/cline/contents/apps/cli/src/utils/output.ts
  function emitJsonLine(stream, record) {
    const line = `${JSON.stringify({ ts: nowIso(), ...record }, jsonReplacer)}\n`
    ...
  }
  function jsonReplacer(_key, value) {
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
    ...
  }
```

commit `8bbdde2a5c1f972864fe1b954f639c21fac61a40`, 2026-08-14, is the last one to touch `events.ts`. So a `--json` line is `{ts, type: "agent_event", event}`, and `event` is one of the union in `sdk/packages/shared/src/agents/types.ts`'s `AgentEvent`:

```
content_start / content_end   { contentType: "text"|"reasoning"|"tool"|"media", text?, reasoning?, toolName?, toolCallId?, input?, output?, error? }
iteration_start / iteration_end
notice, usage
done    { reason: "completed"|"max_iterations"|"aborted"|"mistake_limit"|"error", text, iterations }
error   { error: Error, recoverable, iteration }   # Error serialized to {name, message, stack} by jsonReplacer
```

The README's own automation example agrees with the source, not the reference: `cline --json "..." | jq -r 'select(.type == "agent_event" and .event.text) | .event.text'`.

**The probe — there is no dedicated one, checked against the source rather than assumed from the doc's silence:**

```
$ gh api /repos/cline/cline/contents/apps/cli/src/commands/auth.ts
  async function runInteractiveAuthTui(input) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      input.io.writeErr("interactive auth setup requires a TTY (use --provider/--apikey/--modelid for non-interactive setup)")
      return 1
    }
    ...
  }
```

Bare `auth`, run the way `checkHost` runs a probe (no TTY, output piped), always hits this branch — it reports "no TTY", never "logged in" or "logged out". `config`'s source (`apps/cli/src/commands/config.ts`) confirmed the same for the other candidate: `config --json` genuinely runs without a TTY and prints JSON, but the JSON is `loadInteractiveConfigDataForCommand`'s workflows/rules/skills/hooks/agents/plugins/mcp/tools — no provider field anywhere in `InteractiveConfigData`. `doctor.ts` was read in full and is CLI/hub-daemon process health, not credentials.

What is documented, in `apps/cli/README.md` and the repository's own `AGENTS.md`:

```
# apps/cli/README.md
For non-interactive runs, if an OAuth provider is selected and no saved credentials
are available, `cline` fails fast with an authentication message instead of
launching a hidden browser flow.

# AGENTS.md (repo root)
An actual agent turn requires an LLM provider credential. With no credentials
the default `cline` provider fails fast with an `Unauthorized` error and the
interactive TUI shows a provider sign-in screen.
```

That is the probe: `--json --auto-approve true "Reply with ok."`, and `loggedIn` reads a `done` event as signed in, an `error` event naming the auth failure as signed out, and anything else — a rate limit, a network error — as unread rather than guessed at.

## Task report — Cline

RED first, same discipline as the Codex/OpenCode pass: `hosts.test.ts` gained cline assertions and `other-hosts.test.ts` gained `cline` in `OTHER_HOSTS` against a module and a fake that did not exist yet.

```
$ pnpm exec vitest run --project integration test/integration/other-hosts.test.ts
FAIL > a logged-out cline is caught before a worktree exists
  AssertionError: expected reason to contain "not logged in", got
  "… cline.mjs could not report its authentication status"
Tests  1 failed | 15 passed (16)
```

The other fifteen passed on the first run — dispatch, log rendering and attended refusal were already host-shaped enough. The one failure was real: `checkHost`'s `catch` had never had to read a *failed* probe's own output, because every other adapter's probe exits 0 regardless of login state. Cline's probe is a real task, so a signed-out run exits non-zero, and the fix is in `host.ts`'s shared catch (one branch, all five hosts), not in the adapter.

GREEN:

```
$ pnpm exec vitest run --project integration test/integration/other-hosts.test.ts
Test Files  1 passed (1)
Tests  16 passed (16)

$ pnpm exec vitest run packages/core/src/hosts.test.ts packages/core/src/tail.test.ts packages/core/src/host.test.ts
Test Files  3 passed (3)
Tests  76 passed (76)
```

## Known gaps — Cline

- **No live Cline session drove the loop, and no live probe was ever run.** Every recording here is source-derived or reference-derived, never captured off a running `cline`. The fake (`test/integration/hosts/cline.mjs`) encodes what the source says the CLI does; it has not been checked against the binary itself.
- **The auth probe spends a real turn.** Every other host's readiness check is free. Cline's is not — a signed-out dispatch burns one trivial completion before SOBER can say so, and a signed-in one burns it silently on every dispatch's checkHost call. This is disclosed in ADR 0066 and in the README rather than hidden.
- **The `Unauthorized` wording is one string from one file (`AGENTS.md`), not a stable API.** A Cline release that changes the message, or that starts returning a structured error code instead of prose, breaks `loggedIn`'s classification silently into `null` (§2.8's refusal, not a false positive) — but it does break it, and there is no test against a real release to catch the day it happens.
- **No model catalogue.** Confirmed absent in the CLI's own command table, not merely unimplemented here — `sober models` does not gain a `cline` source, and `models.ts` is unchanged.
- **No plugin.** MCP-in-session and decisions-in-session are both future work, named as such and not started.
