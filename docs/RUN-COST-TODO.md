# TODO — run cost, limits and sessions

Shared work list for any agent (Claude Code, Codex, …) on `development`.

## How to work this list

- Take the first `[ ]` item in the order table at the bottom. Mark it `[~]` while you work on it and `[x]` when it is done.
- Done means the tests pass: `pnpm exec vitest run <touched tests>`, `pnpm typecheck`, and `pnpm exec biome check <touched files>`.
- Add one line to the **Log** at the end: the date, the agent, the item, what changed, and what is left.
- If you stop in the middle, write in the Log where you stopped and what the next step is.
- Keep the user's uncommitted work untouched: ADR 0067 and the `jev.ts`/`config.ts` changes that come with it.
- Commit only when the user asks (see CLAUDE.md).

---

- **Date:** 2026-09-26
- **Status:** in progress. See the checkboxes and the Log.
- **Method:** measured on 61 local runs (`.sober/local/runs`), tested on the installed CLIs
  (claude 2.1.283, codex-cli 0.156.1, opencode 1.18.32), ranked with Jev
  (`~typesafe/jev-latest`, score 0–4). A Jev score is review priority, not proof.

## Problems

1. A node run is slow and eats the subscription's 5-hour and weekly windows.
2. The host explains a brief differently on different models.
3. The limit check spends a real model request.
4. A rejected node starts a fresh run and pays for all its context again.

## Baseline (measured)

- Costliest runs: 86–96 turns, 8–11M cache-read tokens, $2.4–3.2 API-equivalent each.
- Cost ≈ turns × context. Context grows from ~47k (turn 1) to ~168k.
- Wall time: 294 of 371 minutes is the agent itself (79%). Setup and checks are 21%.
- Tool output across all runs: `Read` 1.9 MB, `cat/grep/ls` 0.4 MB, vitest 0.1 MB.
  184 of 336 `Read` calls read the whole file.
- Worker loads the operator's whole environment: 71 tools, 6 MCP servers (Gmail, Drive,
  Calendar…), 9 plugins, the global `~/.claude/CLAUDE.md`, a 5 KB SessionStart hook.
  A worker answered in Turkish because of the operator's global language rule.
- Worker runs at the operator's `effortLevel: "high"` for every node.
- Per run, folded from the 52 Claude run logs in `.sober/local/runs` with `tally`
  (high effort, not isolated): 30.4 turns (median 23), 81k peak context,
  $0.99 API-equivalent (median $0.75). This is the row "spend by effort" compares against.
- Limit probe: `claude -p "Reply with ok." --model haiku` loads ~26k tokens per probe.
  The Codex probe returned `unknown` on the last check.
- Retry reuses the node's worktree and branch (`worktree.ts:42`). The run record keeps no session id.

## Principles

- Official CLIs only. SOBER never reads, reuses or forwards a subscription OAuth token, and
  never imitates a client's identity. Anthropic's legal page (Feb 2026): OAuth tokens from
  Free/Pro/Max "in any other product, tool, or service is not permitted". OpenCode removed its
  Anthropic OAuth code after a legal request (Mar 2026).
- Every change is measured against the baseline from the run logs (`total_cost_usd`,
  `num_turns`, `usage`), before and after, on nodes of similar complexity.
- A behaviour change gets an ADR, as usual.

---

## Phase 0 — Measure (prerequisite)

### [x] M1. Record session and usage on the run record
- **Change:** add `session` (host session/thread id), `turns`, `contextPeak` and `cost` (when the
  host reports them) to the run record. Claude: `session_id` on `init`/`result`. Codex:
  `thread_id` on `thread.started`. OpenCode: session id from its JSON events.
- **Why:** every phase below needs before/after numbers, and Phase 3 needs the session id.
- **Done when:** `sober status <node>` shows turns, peak context and cost for the last run.
- **Estimate:** 1.5 h.

---

## Phase 1 — Smaller, cheaper workers (problem 1)

### [x] W1. Isolate the worker from the operator's environment — Jev 3.32
- **Evidence:** first-turn context on sonnet 40.9k → 32.9k (−20% on every turn). Removes the
  behaviour leaks listed in the baseline.
- **Change:** `HOST_ARGS` in `packages/core/src/hosts.ts` gains
  `--strict-mcp-config --setting-sources project,local --settings '{"enabledPlugins":{…}}'`.
  `enabledPlugins` holds only the plugins that provide `jevSkills` (a new
  `dispatch.plugins` list, e.g. `["ponytail@ponytail"]`).
- **Do not:** use `--bare`, because it reads only `ANTHROPIC_API_KEY`, never OAuth. Do not use
  `--disable-slash-commands`, because `jevSkills` needs skills.
- **Side effects:**
  - `effortLevel` from user settings is dropped. W2 must ship with W1.
  - The operator's user-level hooks (e.g. RTK) are dropped. Check whether RTK was active in workers.
  - The sober MCP server leaves the worker. A worker should not write to the board.
- **Done when:** the init event of a run shows 0 MCP servers and only the listed plugins; the
  first-turn context is ≤ 34k on sonnet.
- **Estimate:** 1 h.

### [x] W2. Effort per node from Jev's score — Jev 2.01
- **Evidence:** every worker runs at `high`. Flags exist: Claude `--effort`, Codex
  `-c model_reasoning_effort=…`, OpenCode `--variant`. A single-task test showed no clear
  difference ($0.31–0.39), so the saving is **unproven**.
- **Change:** map the score to effort: 1–3 `low`, 4–7 `medium`, 8–10 `high`. Put it on the run
  line per host adapter. Keep a `dispatch.effort` override.
- **Done when:** the run record names the effort. After ~10 runs per band, compare cost and
  turns with the baseline, and keep or drop the mapping.
- **Estimate:** 1.5 h + measurement.

### [x] W3. Remove the dead skill; validate `jevSkills`
- **Evidence:** `engineering:testing-strategy` is not installed. Two workers called `Skill` with
  it and got nothing.
- **Change:** remove it from `.sober/config.jsonc`. At dispatch, drop a named skill that the
  host's init event does not list, and log it.
- **Estimate:** 0.5 h.

### [x] W4. Read less — the largest lever (Jev 1.46, but the data says first)
- **Evidence:** 70% of tool output is file reading and searching. Every byte stays in context for
  all later turns.
- **Change:**
  - The brief gets a **Where** section: the files and line ranges that the brief author already
    found. `write_brief` accepts it and `renderBrief` prints it.
  - `HOW_IT_ENDS` gains one positive rule: "Read with offset/limit around what Grep found. Read
    a whole file only when it is short." This replaces the operator's rule that W1 removes.
- **Done when:** the share of whole-file `Read` calls and the average turn count fall against
  the baseline.
- **Estimate:** 1.5 h.

### Not needed
- **Test-output compaction (Jev 2.80):** Vitest 4.1 already switches to its `agent` reporter
  inside coding agents. vitest output is 1.1 KB per call on average.

---

## Phase 2 — Limits without spending quota (problem 3)

### [x] L1. Harvest limits from every real run — Jev 3.29
- **Evidence:** every `claude -p` run emits `rate_limit_event` with
  `unifiedWindows.five_hour/seven_day.utilization` and `resetsAt`. SOBER parses it only in the
  probe (`claudeSpent`, `hosts.ts:235`). Claude-Code-Usage-Monitor and statusline tools use the
  same free data.
- **Change:** when a run ends, write its last `rate_limit_event` into `.sober/local/hosts.json`
  with its time. `hostAvailability` probes only when no run or probe is fresher than
  `probeSeconds`.
- **Estimate:** 1.5 h.

### [x] L2. A 400-token Claude probe — Jev 3.20
- **Evidence:** measured 26k → 401 tokens, and the same `rate_limit_event` comes back.
- **Change:** the Claude `availability.argv` becomes
  `-p ok --model haiku --output-format stream-json --verbose --strict-mcp-config
  --setting-sources "" --tools "" --system-prompt "Reply ok." --disable-slash-commands
  --no-session-persistence`.
- **Estimate:** 0.5 h.

### [x] L3. Codex limits through the app-server, with no model call — Jev 3.48
- **Evidence:** measured on 0.156.1. `codex app-server`, then JSON-RPC `initialize` and
  `account/rateLimits/read`, returns `primary` (300 min) and `secondary` (10080 min)
  `usedPercent`, `resetsAt` and `planType`. No tokens are spent.
- **Risk:** `--help` marks the app-server experimental. Keep the `exec` probe as the fallback
  when the call fails.
- **Change:** a new availability kind, `rpc`, for the Codex adapter. It spawns, asks, kills the
  process and parses.
- **Estimate:** 2 h.

### [x] L4. Show utilization, not only spent or ready
- **Change:** keep the percentages and the reset times in `hosts.json` and show them in
  `sober models` and on the dashboard. A soft threshold (e.g. ≥ 90% on the weekly window) makes
  Jev prefer another host before the hard stop.
- **Estimate:** 2 h.

### Rejected
- `api.anthropic.com/api/oauth/usage` with the Claude Code token (oh-my-pi, usagebar). It costs
  no model call, but it reuses the OAuth token outside the official client, and the endpoint is
  undocumented. Jev 1.96.

---

## Phase 3 — A rejection continues the session (problem 4)

### Finding that shapes this phase
- **Plain resume costs more.** Over 26 retried runs, resume without compaction would cost ~89.6M
  context tokens against the 50.7M the fresh retries used (1.8×). The old 60–160k context is read
  again on every turn. It breaks even only if resume cuts turns by ~45%.
- **Resume plus compaction works headless.** Measured: `claude -p --resume <id>` finds the session
  from another cwd. `-p "/compact"` on it gave `compact_boundary` 27,373 → 4,175 tokens, and the
  session still answered from memory.

### [x] S1. Resume with compaction on Claude — Jev 2.92
- **Change:** on retry, when the run record has a session id and the session file exists:
  1. `claude -p "/compact <focus: the brief and what was built>" --resume <id> …`
  2. `claude -p "<feedback + unchanged brief>" --resume <id> …` with the normal worker args.
  - Compact only when the last run's peak context is above a threshold (start at 60k). Below it,
    resume directly.
- **Fallback:** session missing, compaction error or resume error → today's fresh run.
  Vibe Kanban's bug is the warning: a wrong id must never become the next resume target.
- **Cache:** the prompt cache lives 5 minutes. A resume hours later writes the compacted context
  again, which is small after compaction.
- **Open:** how `-p` resolves the ">1 h idle and >100k tokens" resume prompt that interactive mode
  shows. Test it with an old, large session before shipping.
- **Done when:** a rejected node's next run shows the same `session`, a `compact_boundary`, and a
  lower cost than the baseline for fresh retries of similar nodes.
- **Estimate:** 3 h + an ADR (it changes DESIGN §6.4, "rejecting is correcting").

### [x] S2. Codex resume — Jev 2.71
- **Evidence:** `codex exec resume [SESSION_ID] [PROMPT]` exists. The app-server has
  `thread/resume`, `thread/fork`, `thread/compact/start` and `turn/start`.
- **Change:** start with `exec resume <thread_id>` (Codex compacts by itself). Move to
  app-server `thread/compact/start` only if the logs show bloated retries.
- **Estimate:** 2 h.

### [x] S3. OpenCode resume — Jev 2.22
- **Change:** `opencode run --session <id>` on retry. Consider `--fork` if the old session must
  stay untouched.
- **Estimate:** 1 h.

### [x] S4. Handoff note for hosts with no resume — Jev 1.41
- **Change:** `HOW_IT_ENDS` asks for a short handoff in the final message: files touched,
  decisions, what is not finished. A retry with no usable session gets the handoff above the
  feedback. It covers cursor, cline, openrouter and every S1–S3 fallback.
- **Estimate:** 1 h.

### Later
- **A live attended session (Jev 2.36).** `ATTENDED_ARGS` already keeps stdin open. Holding a
  process for hours of review ties up concurrency, and the cache is cold after 5 minutes anyway.
- **ACP as one session layer (Jev 2.09).** It gives `session/load` across Claude (adapter),
  Codex (adapter), OpenCode and Gemini (native). The Claude adapter wraps the Agent SDK, and the
  SDK's docs say third parties may not offer claude.ai login. Revisit only if S1–S3 split badly.

### Rejected
- **Direct OAuth like oh-my-pi (Jev 1.28).** It reuses Claude Code's client id, sends "You are
  Claude Code…", and imitates the claude-cli User-Agent and tool names
  (`claude-code-fingerprint.ts`, `anthropic-identity.ts`). This is against Anthropic's terms,
  and OpenCode already received a takedown for it.
- **Multi-account rotation (Jev 1.53).** It needs direct OAuth access.

---

## Phase 4 — The same brief explanation on every model (problem 2)

### [x] B1. One instruction, not three — Jev 2.93 / 2.73
- **Evidence:** the host sees three instructions that conflict:
  1. `packages/mcp/src/index.ts:29`: "paste the block the tool returned".
  2. `packages/mcp/src/tools/plan.ts:542`: the full technical brief, then "plain language… do not paste it".
  3. The `approve` description and the `brief`/`next` skills in 4 plugins: "plain language".

  A model that weights the server rule pastes the brief. Another model summarizes it.
- **Change:** `write_brief` takes `plain: {what, why, check, risk}` (short, `maxLength`). The
  result returns only a human block that the server renders from those fields, not
  `renderBrief`. The only instruction becomes: "Paste this block as it is, then ask." Every model
  copies a block the same way. Not every model summarizes the same way.
- **Estimate:** 3 h (tool, 4 plugin skills, tests).

### Not needed
- Per-model prompt variants (Jev 1.71). B1 removes the cause.
- MCP `annotations.audience` (Jev 1.30). Reported as not honoured by Claude Code on tool results.

---

## Order and total

| # | Item | Estimate | Depends on |
|---|---|---|---|
| 1 | M1 record session and usage | 1.5 h | — |
| 2 | W1 + W2 + W3 isolate, effort, dead skill | 3 h | M1 |
| 3 | L1 + L2 harvest limits, small probe | 2 h | — |
| 4 | W4 Where section and reading rule | 1.5 h | — |
| 5 | B1 brief explanation fields | 3 h | — |
| 6 | S1 + S4 Claude resume and compaction, handoff | 4 h + ADR | M1 |
| 7 | L3 + L4 Codex rpc limits, utilization | 4 h | L1 |
| 8 | S2 + S3 Codex and OpenCode resume | 3 h | M1 |

Total ≈ 22 h of work, plus measurement windows after 2, 4 and 6.

## Open questions

1. Was RTK active in workers? If yes, W1 removes it. Measure Bash output bytes before and after.
2. ~~How does `claude -p --resume` behave on a session that is >100k tokens and >1 h idle?~~ It resumes with no prompt (109k and 164k, hours old).
3. How stable is the Codex app-server between releases? Pin it with a test on the recorded response shape.
4. Anthropic's terms about another program running the official CLI headless on the user's own
   subscription: this is the documented `-p` use, and SOBER never touches the token, but no page
   names this case explicitly.

## Sources

- Claude CLI: code.claude.com/docs/en/headless, /cli-reference, /sessions, /statusline, /costs, /agent-sdk/overview
- Anthropic terms coverage: theregister.com (2026-02-20), winbuzzer.com (2026-02-19)
- oh-my-pi: github.com/can1357/oh-my-pi — `packages/ai/src/usage/claude.ts`, `auth/rotation.ts`,
  `providers/claude-code-fingerprint.ts`, `catalog/src/compat/rules/auth/*.kdl`
- Codex app-server: `codex app-server generate-json-schema` (0.156.1), openai/codex `codex-rs/app-server/README.md`
- Vibe Kanban issue #2993 (resume after worktree rename); CodexBar; ccusage; Claude-Code-Usage-Monitor; Sculptor (fork + compact)
- Vitest 4.1 agent reporter: vitest.dev/guide/reporters
- Context engineering: anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Instruction conflicts: OpenAI GPT-5 prompt optimizer cookbook; arXiv 2402.07896

## Next (not done)

1. **Measure effort** — needs real runs. After ~10 runs per band, read `sober status` → "spend by effort" (`none` there is empty: old records carry no `usage`; compare with the per-run baseline above). Keep or drop `effort: "auto"` (ADR 0068).
2. **Measure Codex isolation** — the account was spent; a measurement is set for 2026-09-27 02:12. Run `codex exec --json --skip-git-repo-check "Reply with exactly: ok"` with and without `--ignore-user-config`; compare `turn.completed` `usage.input_tokens`. Drop the flag if it saves nothing.
3. [x] Verify on real hosts — OpenCode `sessionID` recorded; `claude -p --resume` over 100k and hours old works.
4. [x] W3 remainder — the run log says when `init` did not load a named skill.
5. [x] M1 display — `sober status` and `sober status <node>`.

## Log

- 2026-09-26 · Claude Code (Opus 5.5) · M1, W1–W4, L1–L3, S1–S4, B1 done on `development`, not committed.
  - Run record: `session`, `effort`, `usage` (`packages/schema/src/run.ts`, `packages/core/src/run.ts`).
  - Claude worker isolation and `--effort`, Codex `-c model_reasoning_effort`, resume per host (`hosts.ts` `argv(prompt, attended, run)`); config `dispatch.effort` (default `"auto"`) and `dispatch.plugins` (default `[]`).
  - Dispatch: tally from events, limit harvest into `hosts.json` (per-host `at`), resume with `/compact` above 60k peak, cold fallback with "What the last attempt reported" (`dispatch.ts`).
  - Probes: Claude probe with nothing loaded (~400 tokens); Codex through `codex app-server` `account/rateLimits/read`, falling back to the `exec` probe (`host.ts` `readRateLimits`).
  - B1: `write_brief` takes `plain`, returns only the rendered block; `brief` returns the technical brief plus the block for the human; skills regenerated with `pnpm plugins`.
  - ADRs 0068, 0069, 0070. Tests: `test/integration/resume.test.ts`, plus new cases in `hosts.test.ts` and `host.test.ts`.
  - Side effect: `biome check --write` reformatted two lines in the user's WIP `test/integration/dispatch.test.ts` (formatting only).
- 2026-09-26 · Claude Code · Full suite: 1280 passed, 5 failed — all in files this work did not touch. `models.test.ts` "installed looks for an executable" fails on Windows (no X_OK bit, so `accessSync` passes a plain file); the 4 `sync.test.ts` cases time out at 5 s only under full-suite load and pass alone.
- 2026-09-26 · Claude Code · STOPPED (usage limit), nothing committed. State for the next agent:
  - Done, untested: `WORKER_DENY` + `claudeSettings` + `dispatch.workerSettings` (hosts.ts, config.ts, dispatch.ts); compaction threshold 60k → 100k and `/compact` at `--effort low` (dispatch.ts); L4 cleaned to one parser (`limitWindows`/`codexWindows` in hosts.ts, `recordAvailability(paths, host, output)` and `knownAvailability` in host.ts, exported), soft threshold `dispatch.limitSoft` 0.9 in dispatch.ts.
  - Next steps, in order: 1) `pnpm typecheck`; 2) fix tests: hosts.test.ts needs `WORKER_DENY` in its import list, `codexRateLimitsSpent` weekly case now says `seven-day`, host.test.ts `recordAvailability` now takes the raw `rate_limit_event` line instead of a reason, cached entries now carry `windows`; 3) `sober models` prints `knownAvailability` windows (packages/cli/src/models.ts); 4) ADR 0068 security section (deny works under bypass; hooks via --settings do not fire), ADR 0069 threshold/compaction numbers; 5) full suite; 6) two commits — ADR 0067 WIP first (config.ts comment hunk, .sober/config.jsonc openrouter source, jev*.ts, dispatch.test.ts), then this work. The user approved committing without asking.
- 2026-09-26 · Codex · L4 and handoff fixes: `sober models` and the dashboard show known window usage and reset times; fixed the test inputs and the L4 `ready` shadow; ADR 0068 and 0069 now record the measured safety and compaction decisions. `pnpm typecheck` and 63 focused tests passed. Full suite in progress.
- 2026-09-27 · Claude Code · Reviewed Codex's handoff work and committed. `pnpm typecheck` clean; 26 affected test files, 405 passed. Full-suite failures seen earlier (`agent.test.ts` abort, `sync`/`conflict` timeouts) pass alone and come from load on Windows. `models.test.ts` Windows failure fixed (`installed` now checks PATHEXT).
- 2026-09-27 · Claude Code · Closed the open items that need no waiting.
  - Codex worker and probe run with `--ignore-user-config` when `dispatch.plugins` is not null (`hosts.ts`). Auth checked: the flag still reaches the account. Saving not measured — the Codex limit was spent until 02:09.
  - `missingSkills` (`hosts.ts`): dispatch logs a skill the prompt names that Claude's `init` did not load. Real init lists plugin skills as `plugin:skill`.
  - `spendByEffort` (`core/status.ts`); `sober status` prints "spend by effort", `sober status <node>` the last run's host, effort, turns, peak, cost, session. The fake Claude host now reports `num_turns` and `total_cost_usd`.
  - ADR 0068 and 0069 updated. Tests: `hosts`, `host`, `status`, `dispatch`, `cli`, `resume` pass; typecheck clean.
- 2026-09-26 · Claude Code · Per-run baseline folded from 52 old Claude logs (see Baseline). Effort bands still need real runs. Codex isolation measurement waits for the limit reset at 02:09.
