# SOBER v1 — Monorepo playbook

Final ruling: how the monorepo is built, managed, and maintained. One person, part-time, junior, with AI agents alongside. It does not repeat `BUILD-PLAN.md`; it applies it and corrects it in four places. Corrections are marked **→ ADR**: `BUILD-PLAN.md` is binding, so a change there happens through your ADR, not through this file.

Basis: v0's measured history (`REVIEW-2026-08-29.md §2.1`), 201 commits / 11 calendar days / 45 commits on the peak day.

---

## 1. How v0 blew up — the pace view

v0's problem was not slowness. 201 commits in 11 days, an average of 22 commits/day over 9 active days. That is not a human pace, it is an agent pace. Review capacity could not keep up with what the agents produced; code landed unread; rules stayed in prose; on the last day three agents edited the same file.

Ruling: **in v1 the speed limit is not the agent, it is the amount of diff you can read.** No more code is produced in a day than you can read and understand. This one sentence sets the rest of this file.

---

## 2. Building: order

### 2.1 Sequential or parallel

**Phases 0–5 are sequential. Within a phase, at most 2 parallel agents, if three conditions hold** (`BUILD-PLAN.md §5`): the interface exists in a merged file, the file sets do not overlap and contain no barrel, and you can read both diffs today.

Per package:

| Phase | Package | Mode | The only thing that can run in parallel |
| --- | --- | --- | --- |
| 0 | skeleton, CI, fixture | solo | CI YAML ↔ Biome/turbo config (different files) |
| 1 | `schema` | solo | nothing — the record shape comes from one hand |
| 2 | `core` | solo | `status.ts` tests ↔ `git/worktree.ts` (after the module exists) |
| 3 | `cli`, `mcp`, plugin, adapter | solo | independent CLI subcommands ↔ independent MCP tools |
| 4 | sync, contributors, PR | solo | nothing — merge code comes from one hand |
| 5 | `server`, `dashboard` | solo | independent dashboard components (layout from you) |
| 6 | other host adapters | parallel | each adapter in its own directory |

"Solo" = one agent or you. "Parallel" = 2 agents, ceiling 2. The ceiling does not lift before phase 6; the lift condition is `BUILD-PLAN.md:151` ("I read the last four agent diffs line by line").

### 2.2 The gate of each phase

The next phase does not start until the gate is passed. A gate is not a sentence, it is something you can run.

| Phase | Gate |
| --- | --- |
| 0 | 6 checks green on an empty repo **and** one seen red on purpose |
| 1 | `schema` filled with M1 fields, snapshot test exists, `core` does not exist yet |
| 2 | Integration harness green on a real repo: open/close worktree, derive status, render brief, archive |
| 3 | The 9 steps in `BUILD-PLAN.md §3` walked by hand on a real repo — M1 |
| 4 | Two clones, one board, a field-level conflict resolved, a broken graph could not be pushed — M2 |
| 5 | The 9 steps without opening a terminal — M3 |

---

## 3. Building: speed

### 3.1 Calendar — corrected → ADR

`BUILD-PLAN.md §4` measures in "focused days" and puts M1 at 21–29 days. Two corrections:

1. **Phases 0 and 2 run longer for a junior.** Bundling/CI errors become a "debug spiral", not a "reading block"; resolving the first real merge conflict by hand takes a full day.
2. **Phase 5 runs shorter.** The dashboard was not 42,696 lines, it was 8,892 lines (`REVIEW-2026-08-29.md §2.1`). The 14–20 day estimate rests on the wrong number.

| Phase  | BUILD-PLAN | This file | Why                                    |
| ------ | ---------- | --------- | -------------------------------------- |
| 0      | 3–4        | **5–7**   | packaging + fixture + first CI red     |
| 1      | 2–3        | 2–3       | —                                      |
| 2      | 8–11       | **11–15** | git plumbing; first conflict day       |
| 3      | 8–11       | 8–11      | —                                      |
| **M1** | 21–29      | **26–36** |                                        |
| 4      | 8–12       | 8–12      | —                                      |
| 5      | 14–20      | **10–14** | right number, cut screens              |
| **v1** | 43–61      | **44–62** | same total, different spread           |

At 4 focused days a week, M1 is **7–9 weeks**, v1 **11–16 weeks**.

### 3.2 Daily ceiling

- At most **2 agent runs** a day: 2 acceptance lists written, 2 check results read (ADR 0022). A third waits for tomorrow.
- A PR may not exceed **400 lines** (tests excluded). If it does, the node is split wrong; split it.
- The last 30 minutes of the day write no code: they write tomorrow's node and its acceptance list.

### 3.3 Stuck → escalate rule

Not in `BUILD-PLAN.md`. Added:

**If there is no progress on the same error for 2 hours (you + agent combined), stop.** Write the problem in three sentences: what you expected, what happened, what you tried. Then, in order:

1. Find an open-source repo that solves the same problem (`gh search code`), read its approach.
2. If it is an architecture question, open an ADR draft and leave the code.
3. If it is a tool problem (esbuild, pnpm, git), read the official docs from the start, not from memory.

For git plumbing (phases 2, 4) and packaging (phase 0) this rule is **1 hour**.

---

## 4. Delegation map

The principle is from `BUILD-PLAN.md §6`: the specification is yours, the writing is the agent's. If an agent produces something you cannot judge yourself, do not delegate it.

Four modes: **Give** (you review the diff, not the approach) · **Pair** (the agent writes, you read and steer every step) · **You** (the agent only answers questions) · **Read first** (hours).

| Phase | Give | Pair | You | Read first |
| --- | --- | --- | --- | --- |
| 0 | `biome.json`, `turbo.json`, `.dependency-cruiser.cjs`, CI YAML, Changesets, commitlint, Renovate config | **esbuild bundle script + publint + smoke test** (BUILD-PLAN says "Give" → ADR; pair because of ADR 0007's caveats) · coverage ratchet script · integration fixture | branch protection, CODEOWNERS, `tsconfig.base.json` | npm packaging 3 h · `git help worktree` 2 h |
| 1 | Zod schemas (record shape from you) · snapshot test | — | write the record shape on paper | status model on paper 2 h |
| 2 | status derivation, brief render, archive, run log, tests (acceptance list from you) | **`git/worktree.ts`, `git/merge.ts`, file lock, atomic write** (BUILD-PLAN says "solo" → ADR; pair the first time) | storage layout, error classes, `core/index.ts` | `merge=binary`, `:1:/:2:/:3:` 4 h — **resolve a conflict by hand; do not enter phase 2 until it is done** |
| 3 | CLI arg parse, help, output format · MCP tools (after the first 2) · plugin files · secretlint integration | **first 2 MCP tools + elicitation** · adapter (`claude -p` invocation) | the tool list and each tool's contract · the `sober stop` mechanism | MCP elicitation 3 h · Claude Code headless doc, on implementation day, 2 h |
| 4 | contributors.json, claim, same-files warning, opening the draft PR | **field-level 3-way merge · post-merge validation** | the shape of the conflict question | `git help merge`, `git help attributes` again 2 h |
| 5 | HTTP handlers from the wire contract · components (layout from you) · digest | canvas, after the graph library spike | writing the wire contract into `schema` · which screen gets cut | Cytoscape vs sigma spike 1 day |

**Never delegate** (`BUILD-PLAN.md §6`): ADR acceptance, changes to `SCOPE.md`/`CHARTER.md`/`BUILD-PLAN.md`, the record shape, the definition of "done". Addition: **barrel files and `docs/`** never enter an agent PR — CODEOWNERS ties this to required review.

---

## 5. Managing: repo mechanics

`STRUCTURE.md` lists the tools. The missing mechanics, in phase 0:

| Mechanic | What | Why |
| --- | --- | --- |
| `workspace:*` | all internal dependencies | no caret ranges, no "which cli was tested against which core" question |
| `pnpm-workspace.yaml` `catalog:` | all external dependency versions in one place | no `vitest`/`zod`/`typescript` version drift |
| `syncpack` | catalog audit in CI | add to the weekly cleanup |
| tsconfig `composite: true` + `tsc -b` | typecheck gate | project references do not work without it |
| `turbo.json` `dependsOn: ["^build"]` | build order | schema → core → cli |
| `turbo run --affected` | only affected packages on a PR | CI time does not grow with package count |
| Turbo cache (GH Actions cache) | repeated build/test | 3 OS × 6 checks — 20 min without cache |
| `pnpm dedupe --check` | CI | lockfile bloat |
| CODEOWNERS | `packages/*/index.ts`, `docs/`, `.github/` | barrel and docs rule automatic |
| Renovate, grouped, weekly | one PR | 10 separate PRs drown a junior |
| `vitest.config.ts` + `test.projects` | instead of `vitest.workspace.ts` | removed in Vitest 4 |
| `tsconfig.base.json` | `module: NodeNext`, `verbatimModuleSyntax`, `isolatedModules`, `strict`, `noUncheckedIndexedAccess` | ESM-only, explicitly |

---

## 6. Maintaining

The five ratchets of `BUILD-PLAN.md §7` stay. Three additions:

**6.1 Rhythm**

| When | What | Time |
| --- | --- | --- |
| Every day | tomorrow's node + acceptance list | 30 min |
| Every week | `knip`, `depcheck`, `syncpack`, the Renovate PR | 30 min |
| Every week | every `ponytail:`/`TODO` older than a month is read, and either closed or turned into an ADR | 15 min |
| Every phase gate | changesets collected, version cut, CHANGELOG read | 1 hour |
| M1, M2, M3 | `npm publish` — `0.x` at M1, `1.0.0` at M3 | — |

**6.2 Numeric ceilings** — alarms, not ratchets

- `core` export count > 60 → CI warning, requires an ADR.
- `apps/dashboard` line count > 1.5 × `packages/core` → stop, cut screens. v0's real ratio was 0.67; 1.5 is where screens start to outgrow core.
- A phase went past 1.5 times its estimate → rewrite the phase gate, do not continue.

**6.3 Cutting versions**

With Changesets. `cli` is the only published package, no `fixed` group needed. Versions are cut only at phase gates; no cuts in between. Every cut uses `--provenance`.

---

## 7. Phase 0 — the first 5 days, day by day

The 11 steps of `STRUCTURE.md`, split into days. On its own terms: **this does not start until the REVIEW-2026-08-29 §5 "Must" list is done.**

| Day | Work | Mode |
| --- | --- | --- |
| 1 | `create-turbo`, layout, `packageManager`/`engines` pin, `tsconfig.base.json`, `catalog:`, Biome, commitlint, Changesets, CODEOWNERS | Give + You |
| 2 | dependency-cruiser 4 rules, `turbo.json`, `vitest.config.ts` projects, coverage ratchet script | Give + Pair |
| 3 | esbuild bundle script, publint, pack-install smoke, `secretlint`, `.gitattributes` | **Pair** — read packaging for 3 hours first |
| 4 | integration fixture: temp repo + bare remote + commit/push test; CI YAML, 3 OS | Pair + Give |
| 5 | branch protection, Renovate, break the ratchet on purpose (type-error PR → red), fix it | You |

Evening of day 5: 6 checks green, one seen red. Phase 1 starts.

---

## 8. Where this file contradicts BUILD-PLAN → ADR

1. §3.1 pace table (phases 0/2 run longer, 5 runs shorter).
2. §3.3 stuck → escalate rule (new).
3. §4 esbuild/publint "Give" → "Pair"; phase 2 git code "solo" → "Pair".
4. §6.2 numeric ceilings (not a new ratchet, an alarm).

All four became one ADR: **ADR 0023**, accepted 2026-08-29. `BUILD-PLAN.md` §4, §5, §6, §7 were corrected to match. This file no longer contradicts BUILD-PLAN.

The unit of review changed too: check results, not diffs (ADR 0022). "2 diffs a day" in §3.2 → "write 2 acceptance lists and read 2 check results a day".
