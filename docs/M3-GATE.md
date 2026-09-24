# M3 — the gate, run

- Date: 2026-09-07
- Repository: `sober-m3-gate-mtr7rdxs`, a real private repository on the owner's
  GitHub account, built by `scripts/m3-gate.mjs` — real `package.json`, real
  lockfile, real `node --test`, real Actions workflow. Deleted at teardown.
- CLI: installed globally from its own tarball, never from the checkout. The
  dashboard client is inside that bundle (bd3aa9d), so the browser loaded what
  npm ships, not what Vite serves.
- Host: Claude Code 2.1.263, real, for the plan and the brief
- Driver: the owner, by hand. No Playwright, no chrome-devtools, no replayed
  clicks.

`BUILD-PLAN.md` §3 says M3's gate is the same nine steps with no terminal,
driven by a person. All nine ran, and so did ADR 0037's extra step and the
three screens that had never had a reader.

## What "no terminal" means, stated before it was tested

`sober init` and `sober dashboard` are terminal commands by construction —
ADR 0037 keeps the server in the foreground and `Ctrl-C` is how it stops — and
planning is a host session by ADR 0009. So the shell is opened three times: to
install, to init, and to serve. The claim under test is what happens after
that: **no `sober <verb>` is typed.**

**It was not.** Accepting the proposal, answering both decisions, approving the
brief, starting the run, reading the review, accepting it, dismissing a flag and
editing an answer were all clicks. The driver reached for the command line
exactly zero times after step 1.

| # | Step | Result |
| --- | --- | --- |
| 1 | install globally, `sober init`, `sober dashboard` | the server came up and the browser loaded the bundled client |
| 2 | `/sober:plan`, intent in free text | two nodes, the edge between them, two decisions — one `module-boundaries`, one `error-handling` |
| 3 | see the proposed nodes and edges; accept as a batch | on the canvas. Each node bound to one decision; the second depends on the first |
| 4 | open a decision on the decision screen, pick through it | both answered from the screen — `separate-file` and `throw` |
| 5 | read a node's brief in the panel, approve it | the session wrote the approach; the approval was a click |
| 6 | start the run from the canvas | worktree, setup, a real `claude -p` |
| 6b | close the tab mid-run, reopen it (ADR 0037) | the run was still there |
| 7 | the scan runs, the review screen shows the diff and the findings | it did |
| 8 | accept from the review screen | local merge, worktree removed |
| 9 | a downstream node moves off `blocked` | on the canvas, with no reload |
| 10 | the digest (§7.1) | the bar on open: Bob's node as a delta, the flagged count as a snapshot |
| 11 | the flagged-node flow (§7.2) | dismissed with a reason; the other node stayed flagged |
| 12 | the impact preview (§2.8) | the fan-out above the button, the second click applied it |

**Green. The loop closes with no terminal.**

The status derivation was read off the records mid-drive and matched `statusOf`
exactly: `needs-brief` on the free node once its decision was answered,
`blocked` on the one below it. Nothing on the board disagreed with what the
canvas painted.

## What it found

Five things, all of them about what the screen says rather than what it does.
Every step passed; none of these stopped one. Nothing was fixed during the
drive — a fix mid-drive invalidates every step after it, which is why both
earlier gates fixed in the commit after.

**The screen does not speak while it works**

1. **Pressing review gives no sign that anything is happening.** No spinner, no
   pending state, no disabled button. The screen reads as frozen for a moment,
   and the only way to know it is not is to wait. Every other surface in this
   product narrates: `sober review` prints its scan, its criteria and its diff
   in order. The screen inherited the operation and not the narration.

2. **Nothing on the screen ever says what the next move is.** A node sitting on
   `needs-brief` in the panel is a status and no instruction. This is
   `M2-GATE.md`'s finding 6 arriving on the second surface, and it costs more
   here: the command line ends nearly everything it prints with `Next: …`
   (`work.ts`, `flag.ts` and `review.ts` all do), and the panel prints nothing.
   The driver knew the next step from having written the product; a person with
   no terminal has nowhere else to read it.

3. **The node panel renders markdown as plain text.** The approach and the
   acceptance list are written by an agent, and an agent writes markdown —
   headings, lists, inline code. The panel shows the source. It is readable and
   it is not what was written.

**The run is opaque**

4. **A run cannot be watched from the screen at all.** There is no run output
   anywhere in the dashboard: `logs` does not appear in one line of
   `apps/dashboard/src` or `packages/server/src`. `sober logs <node>` is the
   only way to read what the agent said, and it is a terminal command. A
   dispatch is the longest and most expensive operation in the product; the
   screen shows a status while it runs and a diff when it is over, with nothing
   in between.

   The step still passed — the run started, survived a closed tab, and finished.
   What is missing is the reading, not the running. The driver's ask was for
   something close to watching a session, and accepted that it need not be
   truly live. Whether that is v1.x or a defect is a product decision, not this
   record's.

**The session**

5. **There is no command for writing a brief.** The plugin ships four skills —
   `plan`, `decide`, `next`, `loop` — and the brief is written inside `next` and
   `loop` rather than by a command of its own. The driver asked for it in free
   text ("write the brief for `<id>`"), which worked. `plan` and `decide` each
   earned a command; step 5 is the third thing a human asks a session for, and
   it has none. A short, structured skill would do — the point is the one
   keystroke, not the prose.

## The gate script's own

- **The step list lived only in terminal output.** Twelve steps of bold and dim
  ANSI in a scrollback that the plan output then buried, and the driver asked
  for a file. The script now writes the whole drive sheet as markdown beside the
  repository — never inside it, so the tree it is judging gains no untracked
  file — and prints the path. `m1-gate.mjs` and `m2-gate.mjs` have the same
  problem and are left as they are.
- **Teardown is final and the script does not say so.** `npm rm -g` and
  `gh repo delete` take the board, the seeded records and the remote together.
  The teardown line is printed the moment the repository exists, per
  `m2-gate.mjs`, and now says a stopped drive cannot be resumed after it.
- **`--seed` says "after step 9" and does not check.** It writes records and
  pushes from a second clone, neither of which needs a finished node, so it will
  run at any point. The instruction is a convention the script does not enforce.

## Left open

- Findings 1 to 5 are recorded and none is fixed. They belong in the commit
  after this one, with a test each where a test is what proves it.
- Finding 4 is the one with a scope question behind it: a run view on the screen
  is a feature, not a repair, and `SCOPE.md` does not list one.
- The gate ran on one machine, one operator, one host. M2's finding 1 — the
  dispatched agent inheriting the operator's global configuration — was not
  re-checked here.

## Running it again

```
pnpm gate:m3
```

It packs the CLI, installs it globally, creates a real private repository, and
writes the drive sheet to a markdown file whose path it prints. After step 9:

```
node scripts/m3-gate.mjs --seed <alice>
```

which seeds a decision answered after two briefs were approved — so one finished
and one unfinished node are both flagged — and pushes a node from a second clone
so the digest's delta half has a real remote-tracking ref to diff against
(ADR 0042). It rewrites the drive sheet with steps 10 to 12.

Step 6 spends real money and the Actions minutes are real. The teardown line is
printed the moment the repository exists and again at the end; running it ends
the drive for good.
