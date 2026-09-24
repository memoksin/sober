# v1.x item 5 — a plugin and an adapter for Cursor

- Date: 2026-09-08
- Decision: ADR 0052
- Branch: `main`, from `30b2b06`

No plan file. The journeys below were derived from `SCOPE.md`'s Cursor SHOULD row and from the three questions the work surfaced before building; the answers to those three are recorded in ADR 0052 and are what this implements.

## What the user asked for, and what was built

| Asked | Answered |
| --- | --- |
| What is the evidence bar — install the CLI, or read the published reference? | The published reference. Nothing was installed, and what that leaves unproven is the section below rather than a footnote. |
| Which of Cursor's two plugin formats? | Cursor's own (`.cursor-plugin/plugin.json`), not the portable Agent Plugins one — it is the only one of the two that can later carry a hook. |
| Cursor's binary is `agent`. What is accepted as a host name? | `cursor` and `cursor-agent`. A bare `agent` is refused by name, with the refusal saying what to do about it. |

## The recordings — and what is not one

**Cursor's CLI is not installed on this machine.** `which cursor-agent`, `which cursor` and `which agent` all answered "not found" before any code was written. Every flag and every event shape in the `cursor` adapter was read off Cursor's published CLI reference on 2026-09-08 — never from memory, which is what BUILD-PLAN §6 forbids — and **not** off a running binary, which is the higher bar ADR 0048 met for Codex and OpenCode.

The pages, fetched as markdown because `docs.cursor.com` renders in the browser and returns an empty shell to a plain HTTP fetch:

```
https://cursor.com/docs/cli/reference/parameters.md      16113 bytes
https://cursor.com/docs/cli/reference/output-format.md   11053 bytes
https://cursor.com/docs/cli/headless.md                   7442 bytes
https://cursor.com/docs/cli/reference/authentication.md   1652 bytes
https://cursor.com/docs/cli/installation.md               1017 bytes
https://cursor.com/docs/plugins.md                       17546 bytes
https://cursor.com/docs/mcp.md                           16819 bytes
https://cursor.com/docs/agent/security/run-modes.md      18010 bytes
```

What each row of the adapter table came from:

| Row | Read from | Text |
| --- | --- | --- |
| `probe` | authentication | `agent status` "will display: whether you're authenticated"; the troubleshooting section quotes `"Not authenticated"` |
| `argv` | parameters, headless | `-p, --print`; `--output-format <format>` `text \| json \| stream-json`; `-f, --force`; `--trust` "(headless mode only)" |
| why `--force` | headless | "Without `--force`, changes are only proposed, not applied" |
| why no `--sandbox` | run-modes | `--force` is Run Everything, whose Sandbox column reads **No** |
| `attendable` | parameters | `agent [prompt...]` takes one prompt; nothing reads stdin mid-run |
| `line` | output-format | the full NDJSON example sequence, reproduced in `test/integration/hosts/cursor.mjs` |
| elicitation | mcp | "**Elicitation** — Supported — Server-initiated requests for additional information from users" |
| plugin format | plugins | Cursor Plugins use `.cursor-plugin/plugin.json`; components are discovered from default directories |

**The two unknowns, and how each is handled rather than guessed.**

1. **The binary's real name.** The installation page verifies with `agent --version`; older releases shipped `cursor-agent`. The adapter accepts `cursor` and `cursor-agent` and refuses `agent`, so the unknown costs a user one word in `dispatch.host` rather than a silent misdispatch.
2. **The keys of `agent status --format json`.** The flag is documented; the object is not. The adapter does not use it. It reads the text output and the sentence the authentication page quotes, and returns `null` — never a silent pass — for anything else.

**What no test here proves.** That a live Cursor session drives the loop; that the installed binary is named what the reference says; that `agent status` prints the sentence the authentication page quotes. Those are a gate. This says so rather than claiming what it did not run.

## User journeys

1. As someone using Cursor, I want the same board, decisions and review inside my session, so that I do not have to switch hosts to plan.
2. As that person, I want a decision to reach me on screen rather than being answered on my behalf — this host can ask, and should.
3. As someone dispatching a node, I want to point `dispatch.host` at Cursor and have the node actually run, commit, and read back as a run rather than as raw JSON.
4. As someone whose `dispatch.host` is the word `agent`, I want to be told that is not a name SOBER can resolve, rather than silently getting one host's flags on another host's CLI.
5. As someone reading a run log afterwards, I want the human's half of the transcript to hold only what a human said.
6. As a maintainer, I want the refusals in the loop skill to be one sentence in one place, so that four copies cannot drift.

## RED, then GREEN

| # | Stage | Command | Result |
| --- | --- | --- | --- |
| 1 | RED | `pnpm vitest run packages/core/src/hosts.test.ts` | `9 failed \| 2 passed` — `UnknownHostError: SOBER has no adapter for \`cursor\`. The hosts it can launch are claude, codex, opencode`, and `expected null to match object { kind: 'tool', text: 'read README.md' }` |
| 1 | GREEN | same | `11 passed` |
| 2 | RED | `pnpm vitest run test/integration/plugin.test.ts test/integration/other-hosts.test.ts` | `8 failed \| 14 passed` — five `ENOENT` under `packages/cursor-plugin/`, three dispatch failures with no `hosts/cursor.mjs` |
| 2 | GREEN | same | `22 passed` |
| 3 | RED | `pnpm vitest run packages/core/src/hosts.test.ts` | `1 failed \| 11 passed` — the prompt echo rendered as `{ kind: 'answer', text: 'the whole brief' }` |
| 3 | GREEN | `pnpm vitest run packages/core/src/hosts.test.ts packages/core/src/tail.test.ts` | `28 passed` |

Stage 2's RED was recorded by moving `packages/cursor-plugin` and `test/integration/hosts/cursor.mjs` aside and running the pair against a tree without them; the adapter from stage 1 was already in place, which is why three of the failures are dispatch rather than resolution.

Stage 3 is the one finding that changed the code beyond adding a host. Cursor's `stream-json` is Claude Code's, event for event, except for tool calls — and the one place that is not benign is `type: "user"`. Claude Code emits it only under `--replay-user-messages`, which is attended mode, carrying what the human said (ADR 0046). Cursor emits it on every run, carrying the brief SOBER itself sent. So every Cursor run log opened with the whole brief — `NO_HUMAN` and all — in the half of the transcript kept for the human's own words, on a host nobody can be watching. The test was written first, and it failed for exactly that reason.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | `cursor` and `cursor-agent` both resolve to the Cursor adapter, and a bare `agent` is refused | `packages/core/src/hosts.test.ts:Cursor answers to its own name and to the binary's, and not to \`agent\`` | unit | PASS | `pnpm vitest run packages/core/src/hosts.test.ts` |
| 2 | A host with no adapter is refused by name, naming all four | same file, `a host SOBER has no adapter for is refused by name` | unit | PASS | same |
| 3 | Every adapter, Cursor included, tells a headless run nobody can answer it | same file, `every adapter tells a headless run that nobody can answer it` | unit | PASS | same |
| 4 | The brief reaches every adapter as an argument, never a shell string | same file, `the brief is an argument, never a shell string` | unit | PASS | same |
| 5 | Cursor cannot be attended, and says so rather than pretending | same file, `only Claude Code can be attended` | unit | PASS | same |
| 6 | Cursor's readiness is asked in text, and an unreadable answer is a refusal | same file, `a logged-in host reads as ready` and `a status no adapter can read is a refusal` | unit | PASS | same |
| 7 | A Cursor tool call renders once, at the start; the four shapes it shares with Claude Code still render; a tool with no path of its own still names itself | same file, three `renderLine` tests | unit | PASS | same |
| 8 | A host echoing its own prompt is not a human answering | same file, `a host echoing its own prompt back is not a human answering` | unit | PASS | same |
| 9 | A whole Cursor run renders as start, tool, text, result — and the echo is not a line | `packages/core/src/tail.test.ts:a Cursor run renders its start, its tools, what it said and its end` | unit | PASS | `pnpm vitest run packages/core/src/tail.test.ts` |
| 10 | A node dispatched to Cursor runs in a worktree, commits, and records how it exited | `test/integration/other-hosts.test.ts` (parameterised over three hosts) | integration | PASS | `pnpm vitest run test/integration/other-hosts.test.ts` |
| 11 | A Cursor run reads back as a run, with no raw JSON and no `answer` line | same file, `reads back as a run, not as raw JSON` | integration | PASS | same |
| 12 | A logged-out Cursor is caught before a worktree exists | same file, `a logged-out cursor is caught` | integration | PASS | same |
| 13 | An attended run on Cursor is refused before the worktree | same file, `cursor cannot be attended` | integration | PASS | same |
| 14 | The Cursor manifest names the plugin and its components sit where Cursor looks | `test/integration/plugin.test.ts:the Cursor manifest names the plugin` | integration | PASS | `pnpm vitest run test/integration/plugin.test.ts` |
| 15 | Cursor declares the same MCP server the CLI publishes, in its own file | same file, `every host declares the server the CLI publishes` | integration | PASS | same |
| 16 | The four hosts' skills are what the one source builds, and the refusal list is identical in all four | same file, `what is on disk is what the source builds` and `the refusals are the same sentence in every host` | integration | PASS | same |
| 17 | The Cursor plugin does not claim a hook it does not ship | same file, `a host that cannot enforce the block says so` | integration | PASS | same |

## Coverage and known gaps

`pnpm coverage:check` green on every package; the baseline is unchanged, and `core` holds at its post-`30b2b06` figure. The new code in `hosts.ts` is covered by items 1, 7, 8 and 9 above.

Three gaps, stated rather than closed:

- **No live Cursor session.** Item 10's host is a fake (ADR 0014), built from the reference's own event sequence. Nothing here proves a real `agent -p` run drives the loop. That is a gate.
- **The two unknowns above.** The binary's name and `status --format json`'s keys. Both are handled so that being wrong costs a refusal rather than a misdispatch, which is the property that made shipping without them acceptable.
- **`--replay-user-messages`' real shape.** Stage 3 keys the transcript's human half on what SOBER writes to stdin, which is what `test/integration/hosts/claude.mjs` echoes back. If a Claude Code release stamps a session on a replayed user message, attended answers would stop rendering — a missing line rather than a wrong one, and the fix is one condition. Catching it needs a real attended session, which this work did not run.
