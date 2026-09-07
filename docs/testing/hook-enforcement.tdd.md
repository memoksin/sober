# Hook enforcement — TDD evidence

- Date: 2026-09-07
- Decision record: `docs/adr/0047-hook-enforcement-in-the-claude-code-plugin.md`
- Code: `packages/cli/src/hook.ts`, `packages/claude-code-plugin/hooks/hooks.json`
- Tests: `test/integration/cli.test.ts` (six), `test/integration/plugin.test.ts` (one)

## What was being closed

`core` refuses to dispatch a held node and every surface honours that. Inside a host session it was advice: the user's own agent has file tools, and "just build it" reached them. The guard denies an agent spawn that names a held node.

## Journeys

1. As a person planning in a session, when I aim an agent at a node an unanswered decision holds, I am stopped and told which decision, what it asks, and both ways to answer it.
2. As the same person, work on everything the board does not hold is untouched.
3. As someone whose board has a file that will not parse, I am told enforcement did not run over it rather than being let through quietly.
4. As someone opening a session, I am told the guard is there — because a guard that is not installed says nothing, and silence reads as permission.

## RED

Tests written first, against a `sober hook` subcommand that did not exist.

```
$ npx vitest run --project integration cli.test.ts
 FAIL  a spawn aimed at a held node is denied, and the denial says how to answer it
 FAIL  the guard lets through everything the board does not hold
 FAIL  a board the guard cannot read is not silently a pass
 FAIL  outside a board the guard says nothing at all
 FAIL  a session is told at the start whether the guard is live
Error: Command failed: … packages/cli/dist/sober.js hook spawn
× there is no `sober hook`. `sober --help` lists what there is.

 Tests  5 failed | 5 passed (10)
```

Five failures, all of them the intended one: the behaviour is missing, not the harness.

## GREEN

`packages/cli/src/hook.ts` plus one `case 'hook'` in `packages/cli/src/index.ts`, then `hooks/hooks.json` in the plugin.

```
$ npx vitest run --project integration cli.test.ts
 Tests  10 passed (10)

$ npx vitest run --project integration plugin.test.ts
 Tests  5 passed (5)

$ pnpm test
 Test Files  30 passed (30)
      Tests  196 passed (196)

$ pnpm run lint          # biome + secretlint, clean
$ pnpm run typecheck     # 7 tasks, clean
$ pnpm run boundaries    # no dependency violations (196 modules)
$ pnpm run coverage:check
cli: 0% (baseline 0%)   core: 96.54% (baseline 96.54%)   mcp: 90.81% (baseline 90.81%)
```

## What is guaranteed

| # | What is guaranteed | Test | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | A spawn naming a held node gets `permissionDecision: "deny"`, and the reason carries the node, the unanswered decision, its question, `/sober-decide` and `sober decide <id> <option>` | `cli.test.ts:a spawn aimed at a held node is denied…` | integration | PASS |
| 2 | A spawn naming nothing, naming an unknown id, or naming a held id with a character stuck to it is not denied | `cli.test.ts:the guard lets through everything the board does not hold` | integration | PASS |
| 3 | Answering the decision lifts the denial — the guard reads the same `held` as the board | same test | integration | PASS |
| 4 | A node file that will not parse produces a `systemMessage` naming the file and saying enforcement did not run, never a quiet pass | `cli.test.ts:a board the guard cannot read is not silently a pass` | integration | PASS |
| 5 | A repository with no board gets an empty verdict — SOBER says nothing where it has nothing to enforce | `cli.test.ts:outside a board the guard says nothing at all` | integration | PASS |
| 6 | `SessionStart` returns context saying enforcement is live and which nodes are held | `cli.test.ts:a session is told at the start whether the guard is live` | integration | PASS |
| 7 | The plugin declares the guard on `PreToolUse`/`Task` and on `SessionStart`, both calling the `sober` binary `.mcp.json` names | `plugin.test.ts:the guard is declared on the spawn…` | integration | PASS |

Every one of these runs the **built binary** against a **real git repository with a real board**, the way `cli.test.ts` runs the rest of the CLI (`PR-09-08`, ADR 0014). The payloads are the real `PreToolUse` and `SessionStart` shapes, in on stdin; the assertions are on the JSON that comes back on stdout.

## What this does not prove

**That Claude Code obeys the verdict.** The hook runs inside a host process this repository does not own, and no test here can reach it. What is tested is the contract on both ends of that boundary: SOBER emits the documented object, and the plugin declares the hook on the event that carries an agent spawn. Whether the host honours a `deny` is the host's code, and the evidence for it is its documentation, not this suite.

**That every phrasing of "build the held node" is caught.** The guard matches the node id, because the id is the only handle a spawn payload gives it (ADR 0047). A spawn that describes the work without ever naming the node passes. That is a known ceiling of the chosen scope, not a defect of the implementation, and widening it was rejected with its reasons in the ADR.

**Coverage.** `cli` reports 0% because these tests run the packaged binary rather than importing the source; the ratchet's baseline for `cli` is 0% for that reason and is unmoved. `core` and `mcp` are unchanged at 96.54% and 90.81% — this change adds nothing to either.
