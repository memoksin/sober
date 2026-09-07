# 0049 — The auditor: the acceptance list is run, and the review says what each command did

- Status: accepted
- Date: 2026-09-07
- Moves: `SCOPE.md` SHOULD → MUST (the auditor)
- Refines: ADR 0022, ADR 0027; amends `DESIGN.md` §6.0, §6.2

## Context

`SCOPE.md`'s SHOULD list carries "Auditor — automated checks on a finished node, beyond the security scan". ADR 0022 ruled that review is the human reading check results against criteria they approved, and ADR 0027 gave those criteria a shape: a command SOBER runs, and one sentence saying what passing it proves.

Both were built halfway. `schema` carries `Run.verify` and `Run.acceptance`; `config.dispatch.verify` exists; `greenNodes` computes `green` from all four machine facts. And the dispatch path did run the commands — but three things it did made the result unreadable:

1. **A command that was not installed came back as `{ exit: 1 }`.** ADR 0027 §5 asks for `null` there, "so that 'did not run' is never read as 'passed'". A missing command read as a failing one instead, which is the same defect pointing the other way: the human is told the work is wrong when nothing checked it. ADR 0011 already refused this for the scan, and the argument is stronger here, because a criterion is the sentence the human approved as the definition of done.
2. **A run that did not finish wrote `acceptance: []`.** An empty list says "this node asked for nothing". A node with one unchecked criterion asked for one thing and nobody checked it, and only the second is true.
3. **Nothing rendered a result.** All three surfaces printed the criteria as text — `proves` and `run`, no verdict, no exit code — under a heading asking the human to believe them. The command output went nowhere, so a failure had no reason attached to it anywhere.

The whole of ADR 0022's argument is that a human should not have to read a diff to find out whether the work is right. A criterion with no result beside it sends them back to the diff.

## Decision

**The acceptance list is run against the finished work, and every surface renders what each command did.** One module, `core/audit.ts`, owns the execution; the three surfaces render its result and none of them computes it.

1. **Where it runs, and what it can reach.** Each command runs in the node's worktree, through a shell, inheriting this process's environment, capped by `dispatch.timeoutMinutes` — the same reach `dispatch.setup` and `scan.extra` already have, and no sandbox. Running an acceptance list is executing text an agent wrote, so the boundary is stated rather than assumed: **the list is read from the board at the project root, never from the branch under review.** An agent can rewrite `.sober/nodes/<id>.json` inside its own worktree; SOBER never reads that copy. What runs is the list a human approved (ADR 0027 §3), which is the same protection ADR 0019 gives `config.jsonc` by a different route.

2. **Three outcomes, not two.** `{ exit: 0 }` passed, `{ exit: n }` failed, `null` did not run. A command that is not installed is `null`, decided by the shell-portable test the scan already used for `scan.extra` — now shared rather than copied. A run that did not finish records one `null` per criterion, parallel by index (ADR 0027 §5), so the list's length always says how much was asked and the entries say how much was answered.

3. **The reason goes to the run log.** Exit codes are what `green` is computed from; why a command failed is prose, and it belongs where the run's other prose is (`local/runs/<runid>.log`), under a header naming the criterion. The record stays small, which is what ADR 0021 asked of it.

4. **On demand as well as at the end of the run.** `sober audit <node>` runs the list again against the worktree that is already there, and rewrites the last run's results. A criterion that was wrong, or a check that failed for a reason outside the work, does not deserve a second dispatch. Running it when the review is *opened* was rejected: that is exactly the slowness M3's gate raised against the review button, and it would run commands the human never asked to run.

5. **A failure never blocks the accept.** It holds the node out of `green` (ADR 0022 §3) and it renders, in the three words it can honestly be in, above the diff. A machine that refuses an accept is a gate, and in this product a gate is a decision (ADR 0003) — which this is not. The human reads what failed and still decides.

6. **The result travels.** `accepted` gains `audit`: `passed`, `failed`, `did-not-run` or `none`, recorded as it read at the moment a human accepted, beside `scan` and for the same reason. The run record is local and disposable (§5.5), so without this a teammate who clones the board a week later can see that the work was accepted and nothing about what was true when it was. Schema version 4; a board written earlier migrates to `did-not-run`, never to `passed`.

**Nothing else moves off the WON'T list.** "Per-language static analysis of dispatch results" stays out, unchanged and for ADR 0011's reason: one rule set per language a user might write in is unbounded. The auditor runs the commands the project already has. It does not read the code.

## Consequences

- Review renders a verdict beside each sentence on all three surfaces, and `green` is now computable in practice rather than only in principle: before this, any node with an acceptance list was held out of `green` forever, because a missing result reads as "did not run".
- `sober audit` is a new CLI command. It changes local state only — the run record — so no other surface owes it a mirror (MUST #7 runs the other way).
- The shell-portable "not installed" test lives in one place and is used by both the scan and the auditor. It was two copies with one comment between them.
- The trivially-satisfiable criterion ADR 0022 and ADR 0027 both flag is now visible a third time: as a command that exits 0 in a second. A rule constraining criteria shape is still a later ADR if it proves common.
- A criterion is arbitrary code from an approved brief, running unattended at the end of every dispatch. That is the same trust the product already extends to the agent that just worked unattended in that worktree, and the approval is where a human can refuse it. If that approval turns out to be read as carelessly as D26 feared, the answer is a rule about criteria shape, not a sandbox nobody can configure.

## Alternatives rejected

- **Running the list when the review is opened.** Makes opening a review slow — M3's gate raised exactly that complaint about the review button — and runs commands nobody asked to run at the moment they are least expected.
- **Recording a missing command as a failure.** The shortest change, and it tells the human the work is wrong when nothing checked it. `PR-09-06` refused this for the scan; a criterion is a stronger case, not a weaker one.
- **Putting the command output in the run record.** The record is small so that a run killed mid-write leaves a torn log line and never a torn record (ADR 0021). Output is unbounded, and the log already holds unbounded things.
- **Blocking the accept on a failed criterion.** The human owns intent. A machine that refuses is a gate, and this codebase means something specific by that word.
- **Passing the audit verdict into `acceptWork` the way `scan` is passed.** Symmetric, and it is a field three surfaces have to remember to fill — so it ends up saying "passed" on the one that forgot. Derived from the board instead.
- **A sandbox for acceptance commands.** A criterion is a project's own test command; a sandbox that cannot reach the project's toolchain runs nothing, and one that can is the current reach with more configuration. The boundary that does work is which copy of the list runs.
