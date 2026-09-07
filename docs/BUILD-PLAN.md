# SOBER v1 — how the monorepo gets built

The ruling on execution: what order, at what pace, what runs in parallel, and where the work is handed to an agent versus read about for an afternoon first.

`STRUCTURE.md` says what the repository _is_. This file says how it gets there without repeating v0. It is binding on execution the way `SCOPE.md` is binding on capability: changing an order or a gate here takes an ADR.

---

## 1. The three laws

Everything below is an application of these. If a later section seems to conflict with one of them, the law wins.

**Law 1 — the ratchet exists before the work.** A rule that is not a red CI check is a preference. v0's rules were right and every one of them lived in prose; `tsconfig.json` did not exist in that repository, so nothing type-checked, and 69 green test files sat under three defects that reached the browser. Phase 0 is not setup overhead. It is the only phase that decides whether the other five can fail loudly.

**Law 2 — parallel work is only safe behind a frozen contract.** v0's last session ran three agents that all edited `server.ts` and the merge was manual. That is not an agent problem. Two workers are safe when the interface between them already exists in a file neither of them may touch.

**Law 3 — the loop closes before the loop gets features.** v0 wrote its dashboard — 8,892 lines, 427 commits, more commits than any other package — as its last phase, and discovered what the product actually was after writing all of it. The milestones below exist so the loop closes at phase 3, headless, before a single screen is drawn.

---

## 2. Three milestones

`SCOPE.md`'s MUST list is unchanged. This is ordering inside v1, by ADR 0015 — nothing is dropped, and rule 1 still holds: nothing outside MUST gets built.

The cut was made possible by ADR 0009. With planning in a host session, the dashboard is no longer on the path to a working product. Walking the seven steps: frame, decompose, decide and brief happen in a session; dispatch, review and advance happen in the CLI. None of the seven needs a screen.

### M1 — first light

Phases 0–3. `schema` records, `core` without sync, `cli`, `mcp`, the plugin, the Claude Code adapter, `secretlint`, the integration harness. Archive is in — it is a file move, and without it `DESIGN.md` §8.3 leaves a referenced node with no way to be removed at all.

Not in M1: the board branch and sync, conflict resolution, contributors and claim, the dashboard, the draft pull request and CI, the digest, the flagged-node flow and the impact preview, schema migration.

One deliberate refusal: **editing an answered decision is refused in M1**, with a stated reason. The impact preview is M3, and being unable to change an answer beats changing it without the preview that exists to make the fan-out visible.

### M2 — the board travels

Phase 4. Board branch, sync, field-level conflict resolution, the archive-versus-edit question, post-merge validation, contributors, assignment, claim, the same-files warning at claim time, the draft pull request and CI.

Before the dashboard, by Law 2: the dashboard should consume a finished `core`.

### M3 — the dashboard

Phase 5. `packages/server` and the wire contract first, then the canvas, node panel, decision screen, review screen, digest, flagged-node flow, impact preview.

---

## 3. M1's gate is a script, not a sentence

On a real repository:

1. `npm i -g @besober/cli`, then `sober init`
2. In a Claude Code session, `/sober:plan`, intent in free text
3. See the proposed nodes and edges; accept as a batch
4. Open a decision, options are produced, pick through elicitation
5. Ask for a node's brief, read the approach, approve it
6. `sober run <node>` — worktree created, the setup command runs, the agent works
7. The run finishes, the scan runs, `sober review <node>` shows the diff and the findings
8. `sober accept <node>` — local merge, worktree removed
9. A downstream node moves off `blocked`

Nine steps. Green means the product exists. M2 and M3's gates are the same script with a teammate, and then with no terminal.

**Run on 2026-09-04, green.** `pnpm gate:m1` prepares it; `M1-GATE.md` records what it found — fourteen defects, none of which the suite could see against a faked host.

M2's is `pnpm gate:m2`: the same nine steps with a teammate, on a **real private repository** — two clones, a real `gh`, and a real workflow, because a gate that fakes the thing it exists to prove is a demo. `M2-GATE.md` records what it finds.

**Run on 2026-09-05/06, green.** `M2-GATE.md` records it: seventeen steps and the migration, eight defects found, all fixed in the commit after it.

M3's is the same nine steps with **no terminal**, and it is driven by a human rather than by a browser automation. A script that replays clicks answers "do the selectors still match"; the question this gate exists to ask is whether the loop closes for someone who never opens a shell, and only a person can answer that. The script prepares the repository and the board; the drive is by hand, and `M3-GATE.md` records what it finds. ADR 0037 adds one step the earlier gates had no reason to carry: start a run from the screen, close the tab, reopen it, and find the run still there.

**Run on 2026-09-07, green.** `pnpm gate:m3` prepares it; `M3-GATE.md` records it: twelve steps driven by hand with no `sober` command typed after step 1, and five findings, all of them about what the screen says rather than what it does.

---

## 4. Pace

One **focused day** = 5–6 hours of real work, not a calendar day. Estimates include review time and the research blocks in §6.

| Phase | Focused days | Cumulative | Why this long |
| --- | --- | --- | --- |
| 0 | 5–7 | 7 | Configuration, the integration fixture and packaging. For a junior these are debug spirals, not reading blocks (ADR 0023). |
| 1 `schema` | 2–3 | 10 | Small surface. The time goes into the _shape_, not the typing. |
| 2 `core` | 11–15 | 25 | The real work. Git plumbing and derived status are where correctness lives; the first real merge conflict costs a day. |
| 3 `cli`, `mcp`, plugin, adapter, scan | 8–11 | **26–36 — M1** | CLI plumbing is fast. The MCP server, elicitation and the adapter are not. |
| 4 sync, team, pull requests | 8–12 | **34–48 — M2** | Field-level conflict resolution and post-merge validation are half of it. |
| 5 server, dashboard | 10–14 | **44–62 — M3, v1** | v0's dashboard was 8,892 lines — smaller than `core`. Its problem was order, not size. |

**M1 is roughly 7–9 calendar weeks at four days a week. v1 is 3–4 months part-time.** Corrected by ADR 0023; `PLAYBOOK.md` holds the reasoning.

**Stuck rule (ADR 0023).** Two hours on one error with no progress — one hour in git plumbing or packaging — means stop, write three sentences (expected, observed, tried), then: find an open-source repository that solves it; open an ADR draft if the question is architectural; read the tool's own documentation from the start if it is a tool.

The total came down from an earlier estimate of 54–81 even though MUST grew from 11 to 13, because the dashboard left the critical path and the advisory subprocess was dropped. The least reliable row is the last one, which is where the least reliable estimate belongs.

Two rules about the numbers, both more important than the numbers:

**Do not compress phase 2.** It is the phase where a shortcut becomes a defect someone else finds. Every hour cut there is spent twice in phase 5, when the dashboard renders a wrong status and the cause is three layers down.

**Do compress phase 5, by cutting screens, never by cutting checks.** Five screens at good enough beats two at excellent.

---

## 5. Sequential or parallel

### The rule

Two workers may run at once when **all** of these hold:

1. The interface between them already exists in a merged file.
2. Their file sets do not intersect — and no barrel or `index.ts` is in either.
3. You can write both acceptance lists and read both check results today (ADR 0022, 0023).

Condition 3 is the binding one. **Your specification capacity is the bottleneck, not agent capacity.** Review is the check results against criteria you wrote, not the diff (ADR 0022). Two agents need two acceptance lists; if you can only write one you can trust, the second agent runs against a guess and you have re-created unplanned prompting with extra steps.

### Concretely

**Never parallel:** `schema` changes · storage layer · derived status · git plumbing · anything that edits a barrel · anything that changes a document in `docs/`.

**Safe parallel, once the module exists:** tests for already-written modules · independent CLI subcommands · independent MCP tools · independent dashboard components · CI and tooling config · documentation.

**Hard cap: 2 concurrent agents through phase 5.** Not because more would not work — because more diff than you can review is indistinguishable from no review. Raise it when the last four agent runs passed the acceptance lists you wrote for them without a rejection.

**Barrel files are yours.** Agents write modules; you add the export. This one rule would have prevented v0's `server.ts` merge, and it costs ten seconds a module.

---

## 6. What to hand to an agent, what to read about first

### Hand over fully — you review the checks, not the diff

- CI workflows, `biome.json`, `turbo.json`, `.dependency-cruiser.cjs`, Vitest and Changesets config
- Zod schemas, from a record shape **you** wrote down first
- Tests, from an acceptance list **you** wrote down first
- CLI argument parsing, help text, output formatting
- MCP tool definitions, once the operation is specified
- Dashboard components, from a layout you described
- Mechanical refactors, renames, codemods
- Documentation updates that follow a decision you already made

The pattern: an agent is reliable when the _specification_ is yours and the _typing_ is theirs. It is unreliable in the opposite direction — the same line `CHARTER.md` draws between intent and technique. SOBER's own build should obey SOBER's own rule.

### Pair — the agent writes, you read every step (ADR 0023)

- The esbuild bundle script, `publint` and the pack-and-install smoke test. ADR 0007 lists the ways a bundle breaks; a plausible wrong one is not something a junior can evaluate from a diff.
- Phase 2's git code: worktree, merge, the file lock, atomic writes. The highest-risk code in `core`, written once with you watching.
- The first two MCP tools and the elicitation flow.
- Phase 4's field-level merge and post-merge validation.

### Read for two to four hours before writing a line

Each of these is a place where a wrong first attempt costs days, and where an agent will produce something plausible you cannot evaluate.

| Block | Read | Hours |
| --- | --- | --- |
| **git worktrees and branches** | `git help worktree`, `git help branch`. Create three worktrees by hand, break one, recover it. | 2–3 |
| **git merge without conflict markers** | `git help attributes` on `merge=binary` and `-text`, `git help show` for the `:1:`/`:2:`/`:3:` stage syntax, `git help merge`. Then resolve one conflict programmatically by hand. | 3–4 |
| **npm packaging of a bundled CLI** | `exports` semantics, esbuild's `bundle`/`platform`/`banner` options, how a bundler inlines a workspace dependency and what stops it doing so, `publint`. Publish a throwaway scoped package and install it globally. | 2–3 |
| **MCP: tools and elicitation** | The protocol's tool and elicitation shapes, and how Claude Code surfaces an elicitation request. This is what makes `PR-03-09` real. Read off the installed SDK, not from memory: two protocol revisions are in the field, and the newer one's `elicitation.form` capability makes an SDK refuse a request that the older, bare `elicitation` host would have answered. | 2–3 |
| **The gating and status model** | On paper, not in an editor. Write the seven statuses and walk five real nodes through them, including a shared decision bound by three of them. | 1–2 |
| **Host CLI headless invocation** | Each host's current documentation, at the moment you implement the adapter — never from memory, and never from v0's code. `DESIGN.md` §5.1 says why. | 2 per host |
| ~~**Graph library spike**~~ | **Done**, 2026-09-06, and one-sided: 200 nodes, circular, `cose`, hover — in Cytoscape only, with sigma named as the fallback if it disappointed. It did not (ADR 0038). Half the budgeted day, and sigma is un-measured, which is written down as the cost. | ~~1 day~~ ½ |

### Never delegate

Accepting an ADR. Changing `SCOPE.md`, `CHARTER.md` or this file. Deciding a record's shape. Deciding what "done" means for a phase.

An agent that proposes a scope change is doing its job. Accepting one is yours.

---

## 7. Sustaining the repository

Five ratchets. Each targets something that went wrong in v0, and each is a file, not a habit.

**1. A public-surface snapshot per package.** v0's `core` reached 291 exports across 28 modules and nobody noticed it happening. One test file per package:

```ts
test("core exports nothing new without a reviewer seeing it", async () => {
  expect(Object.keys(await import("./index.js")).sort()).toMatchSnapshot();
});
```

Growing the surface now means updating a snapshot in the same PR, where it is visible. This is the cheapest defence in this document against the failure that actually ended v0's `core`.

**2. Coverage ratchets, never drops.** A fixed 80% invites tests written to reach 80%. "Not lower than the last commit" invites tests written for the code that changed. Per package, `schema` excluded, integration coverage included.

**3. One node, one PR, one changeset.** The board is the plan; a PR with no node is work nobody planned.

**4. A deletion pass, weekly, thirty minutes.** `knip` for dead exports, `depcheck` for unused dependencies, a read of the surface snapshot itself (ADR 0028 — this, not the ceiling, is what shaves the surface), and a read of every deliberate shortcut older than a month. Repositories do not shrink on their own, and v0's did not.

**5. Never bypass a check.** If a required check is wrong, change the check, in its own PR, with a reason. v0 allowed the admin bypass and it was used. A ratchet with an override is a suggestion.

Three **alarms** beside the ratchets (ADR 0023). An alarm warns and asks for an ADR; it does not fail the build:

- `core` exports > 100 (ADR 0028, raised for M2 by ADR 0029 — the number moves with the number of consumers, by ADR; the surface snapshot above is the guard that actually catches growth).
- `apps/dashboard` lines > 1.5 × `packages/core` lines. v0's ratio was 0.67; the problem was that the screens came before the loop closed, and this is the only number that would have shown the phase running away.
- A phase past 1.5 × its estimate: rewrite the phase gate before continuing.

---

## 8. v0's failures, and what stops each one

Every row is measured from the archived repository, not from memory.

| What happened in v0 | Measured | What stops it here |
| --- | --- | --- |
| Nothing type-checked | **0** `tsconfig.json` files | Phase 0: `tsc` project references, `strict`, `noUncheckedIndexedAccess`, required |
| CI was one command on one OS | `bun install && bun test`, Ubuntu | Six required checks; `integration` on three platforms |
| Tests green, defects in the browser | 69 test files, 3 defects | Typecheck, plus the temp-repo harness whose coverage counts (ADR 0014) |
| `core`'s surface grew unwatched | 291 exports / 28 modules | The surface snapshot test (§7.1) |
| The screens came before the loop closed | dashboard 8,892 lines, core 13,352 — and no loop ever closed | Law 3: the loop closes at phase 3, headless, before a screen exists |
| Nodes blocked and never opened | 22 of 56 | Decisions are shared records, and every binding holds (ADR 0006) |
| Parallel agents on one file | 3 agents, `server.ts`, manual merge | Law 2, the 2-agent cap, barrels reserved to you, and the same-files warning at dispatch |
| Admin bypass allowed and used | — | No admin bypass, and §7.5 |
| The board became 57 patches on unrecorded decisions | 62 nodes, frozen behind a reform node | Decisions are records with reasons; the board is cut **after** the loop closes once |
| A hand-written SVG renderer lengthened its phase | — | A ready-made library, one-day spike, no hand-written hit-testing (D11) |

---

## 9. Bootstrap

Phase 0's eleven steps are in `STRUCTURE.md`. Two of them are the ones people skip, so they are repeated here:

- **Step 6 — build the integration fixture before there is anything to test.** A temp git repository, a bare repository as its remote, and one trivial test that commits and pushes between them. Law 1: the ratchet predates the work.
- **Step 10 — break the ratchet on purpose.** Open a PR with a type error and watch it go red. A check nobody has seen fail is not known to work.

---

## 10. Carried into later phases

Phase 0 closed on 2026-08-29. Three items from the 2026-08-29 review were deliberately not built there, because each one is infrastructure for something that does not exist yet. They are recorded here, against the phase that creates their subject, and each phase's gate includes its row.

| Phase | Carried item | Why it waits | Cost |
| --- | --- | --- | --- |
| **2** — `core` | A soft ceiling beside the surface snapshot: `core` exports over the ceiling emits a CI warning (§7's first alarm, REVIEW-2026-08-29 §3.6). The snapshot makes growth visible; the ceiling is the second line, for the day one tired reviewer updates a snapshot without reading it. | There is no `core` to count. It belongs in the same file as the snapshot test, written in the same sitting. | ~10 min |
| **3** — `cli` published | ~~npm **provenance** and **trusted publishing**~~ — **done**, phase 3 session 5: `.github/workflows/release.yml` carries `id-token: write`, `NPM_CONFIG_PROVENANCE`, and an npm new enough to mint its own credential, so no publish token is stored in the repository (REVIEW-2026-08-29 §1.2/2, ADR 0007). | Provenance is three lines _inside a release workflow_, and nothing is published before M1. Writing the workflow early means maintaining a workflow that publishes nothing. | ~45 min with the release workflow |
| **4** — contributors | `.github/CODEOWNERS` narrowed past `* @memoksin`: an explicit entry for every barrel (`**/index.ts`) and for `docs/`, which turns §5's "barrel files are yours" from a habit into a check (REVIEW-2026-08-29 §1.2/3). **And**: the admin bypass narrows or is removed (ADR 0026). | With one contributor, `*` already covers every path and the bypass exists precisely because a solo repository cannot satisfy a code-owner review. Both only become real when a second person pushes. | ~15 min |

Phase 0 also closed with four deviations from what this file and `STRUCTURE.md` predicted. All four are recorded where they belong rather than here: TypeScript is pinned at 6.x and the reason is in `STRUCTURE.md`; the owner may bypass `main` and the reason is ADR 0026; `apps/*` is out of `vitest.config.ts` and the `boundaries` command until phase 5 creates the dashboard; and `packages/cli` exists from day one as a stub, so that esbuild, `publint` and the pack-and-install smoke test are real checks before there is a CLI to break — Law 1, applied to itself.
