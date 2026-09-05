# M2 — the gate, run

- Date: 2026-09-05 / 2026-09-06
- Repository: `sober-m2-gate-mtoddx1x`, a real private repository on the owner's
  GitHub account, built by `scripts/m2-gate.mjs` — real `package.json`, real
  lockfile, real `node --test`, real Actions workflow
- CLI: installed globally from its own tarball, never from the checkout
- Host: Claude Code, real, for five dispatches
- Clones: `alice` and `bob`, two working copies of one repository, one machine

`BUILD-PLAN.md` §3 says the gate is a script, not a sentence. All seventeen
steps ran, and so did the migration. Steps 1–9 were driven by the owner in a
host session; steps 10–17 and the migration were driven from the CLI.

| # | Step | Result |
| --- | --- | --- |
| 1 | install globally, `sober init` | `dispatch.setup` detected as `npm ci` from the lockfile |
| 2 | `/sober:plan` | two nodes, the edge between them, two decisions |
| 3 | read the proposal, accept it | one node per file pair; both decisions bound |
| 4 | `/sober:decide` | two answers, each one an elicitation the agent could not fill |
| 5 | read the brief, approve it | approach named real files; approval refused to the agent |
| 6 | `sober run <node>` | worktree, `npm ci`, a real `claude -p`, draft **#1** opened |
| 7 | `sober review <node>` | scan clean, criteria listed, CI read live |
| 8 | `sober accept <node>` | merged into `main` as `55ff249`, worktree removed |
| 9 | `sober status` | the downstream node moved off `blocked` |
| 10 | `sober sync` as Alice | board on `sober-graph`; `git ls-remote` shows nothing about it on `main` |
| 11 | `sober init` as Bob | `5 records, taken from sober-graph` — one board, not two |
| 12 | `contributors add`, `assign <node> Bob` | assignment travels; shown as `→ Bob` against a claim's `@Bob` |
| 13 | `claim` a node whose files meet Alice's | warned, refused nothing; `run` refused naming the file and the person; `--anyway` started it |
| 14 | `sober run` as Bob | his own draft **#2**, then **#3**, on the same repository |
| 14b | reject, then run again | the second attempt kept the first's staged work and opened one draft **#4** |
| 15 | both edit one record, both `sober sync` | asked field by field; `notes=theirs title=ours` honoured per field |
| 15b | one archives it, the other edits it | asked `keep` or `restore`; `restore` put it back on both sides with the edit |
| 16 | `approve --queue` on a blocked node | accepting its dependency started it: `· 1 queued node starting on main` |
| 17 | `accept --green` | refused while CI ran (`CI has not finished`), landed after it passed as `2fd96b42` |
| — | schema 1 → 2 | `· board brought forward from schema 1 to 2 — 5 records rewritten, sync to share it` |

**Green. The product travels.**

Two clones, one board, one repository. Everything M2 was cut for — the board
branch, the field-level conflict, the archive question, contributors, claim,
assignment, the draft pull request, CI, the queue and the migration — ran on a
real host against a real git host.

## What it found

Eight things. None is fixed yet: the gate ran to the end first, on purpose, so
that the fixes are read against a complete drive rather than one defect at a
time.

**The two that cost the drive something**

1. **The dispatched agent inherits the operator's global Claude Code
   configuration.** The run log carries the whole `global:.claude/rules/**`
   tree. A global rule saying "never run `git commit` without asking" made the
   headless agent stop and ask for a confirmation nobody could give: two of five
   dispatches ended with `✓ finished`, an empty branch, no pull request, and the
   work sitting staged in the worktree. The same board on another machine
   produces different results, and one dispatch answered in the operator's
   preferred language. `DESIGN.md` §5.1 says SOBER launches the host the user
   already installed; it does not say the host arrives carrying the user's
   opinions about git. This is the one that breaks the product for a user with
   an opinionated global config.
   *What saved it:* `sober review` says so, plainly —
   `! 2 file(s) in the worktree were never committed · nothing below sees them`.
   The review is what turned a silent nothing into a visible one.

2. **An accepted node leaves an open draft pull request behind.** With the
   defaults — `draftPr: true`, `accept: 'merge'` — `accept` merges into local
   `main` and never touches the pull request; `readyAndMerge` is only on the
   `accept: 'pr'` path. Drafts **#2**, **#3** and **#4** are open on branches
   whose work is already in `main`. **#1** reads `MERGED` only because the owner
   ran `git push` by hand, which is what let GitHub notice. Nothing in the
   product pushes `main`, and nothing says the push is what closes the drafts.

**The record**

3. **`approve` does not refuse a node that is already done.** `approveBrief`
   (`packages/core/src/decide.ts:92`) checks two things: the node is on the
   board, and it has a brief. Approving an accepted node rewrites
   `brief.approval` with a fresh timestamp, so the record now says the approval
   came *after* the acceptance — `approval.at 21:08:02` against
   `accepted.at 21:06:47`. `run` has this guard. `approve` does not.

4. **The success line advertises a command that is then refused.**
   `packages/cli/src/work.ts:154` ends with "Start it with `sober run <node>`";
   on a done node `run` answers "is done, so it cannot start". Two lines, one
   second apart, contradicting each other.

**The team**

5. **Contributor handles are case-sensitive, and a second one is added
   silently.** `sober contributors add bob` succeeded; the claim that followed
   still warned `you are not on this project yet · sober contributors add
   "Bob"`, because `whoami` reads `user.name` from git. Running that left
   `contributors.json` holding both `bob` and `Bob` — one person, two entries,
   no warning. `scripts/m2-gate.mjs` step 12 asks for the lowercase one, so the
   gate walks into it.

**The reading**

6. **`needs-brief` means two different things.** `status.ts:46` returns it both
   for a node with no brief and for a node whose brief is written but not
   approved. The human cannot tell whether the next move is to write one or to
   approve one.

7. **A node id cannot be typed from memory, and nothing helps.**
   `sober run invoice-total` answers `invoice-total is not on this board` — no
   prefix match, no near-miss suggestion — when the id is
   `invoice-total-using-currencies-module-kxgr`. `M1-GATE.md` recorded the long
   ids as "readable, long. No fix." This is what they cost.

8. **A restore reads as a removal.** After `resolve … restore`, the other
   clone's sync printed `updated print-…` and `removed print-… (archive)`
   together. It means removed *from* the archive; it reads as removed from the
   board.

## The gate script's own two

- Step 12 tells you to run `sober contributors add bob`, which is not the handle
  git will report. It should ask for the name in `user.name`.
- The migration section says "`git diff` shows the fields back in order". The
  board's records are not tracked on `main` — they live on `sober-graph` — so
  the diff is empty. `sober status`'s one line and the record itself are the
  evidence; the script should say so.

## Left open

- Nothing was pushed from `main` after the first push, so drafts #2–#4 stay open
  until finding 2 is answered. The answer is a product decision, not a cleanup:
  either `accept` closes the pull request, or `accept` says out loud that a push
  is what will.
- `rounding-helper-for-split-amounts-eaem` is `in-review` with its work
  uncommitted in the worktree — the second casualty of finding 1, left in place
  as the evidence for it.
- The overlap test still matches picomatch either-way (`src/**` against
  `**/session.ts` is a miss). No real board has produced a miss worth the
  machinery.

## Running it again

```
pnpm gate:m2
```

It packs the CLI, installs it globally, creates a real private repository,
clones it twice, and prints the seventeen steps. Steps 6, 13, 14 and 16 spend
real money; the Actions minutes are real too. The teardown line is printed the
moment the repository exists, and again at the end.
