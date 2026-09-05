# ADR 0031 — The git host is a CLI, and a run is judged where it worked

**Status** accepted · **Date** 2026-09-05 · **Phase** 4, session 4

## Context

M2 opens a draft pull request when a run finishes, so CI runs before a human
looks (D32, DESIGN §6.1). Three questions had no answer in `DESIGN.md`, and one
thing turned out to be missing rather than undecided.

## Decision

**1. SOBER talks to the git host through `gh`, as a subprocess.** The same
shape as the agent host (§5.1): the tool is already installed and already
logged in, or the step does not happen. SOBER never asks for a token and never
holds one, which is the property that made `dispatch.host` a command rather than
an API client. GitHub Enterprise works because the user's own `gh` is
configured for it. `SOBER_GH` names the executable for a `gh` that is not on the
PATH, and is what the tests point at a stand-in.

The alternative was the REST API over `fetch`. It removes a dependency and adds
a credential — plus enterprise URLs, rate limits and API versions, all of which
`gh` already solves and none of which SOBER wants to own.

**2. What accepting does is a setting, `dispatch.accept`, defaulting to
`merge`.** A protected main cannot take a local merge and a repository with no
remote cannot take a pull request (D33), but detecting which and switching
silently means the one irreversible command in the product changes behaviour
when somebody adds a remote. A project that wants the other landing writes one
line.

**3. A run is judged where it worked.** `dispatch.verify` and every acceptance
criterion the human approved run in the node's worktree after the agent exits,
and their exit codes land on the run record. This was **specified in §6.0 and
never built**: the fields existed, `finishRun` accepted them, and nothing ever
filled them. `sober accept --green` cannot mean anything without it — with no
results, every acceptance criterion reads "did not run", which is never
"passed" (ADR 0021). Found by driving the demo, not by reading the code.

## Consequences

- A pull request is opened only when the branch holds a commit past its base.
  `gh` refuses an empty one anyway, and a branch with no diff has nothing for CI
  to run — the M1 gate's "the agent wrote files and committed none", wearing a
  pull request.
- CI is read at review time and never cached. "Could not be read" carries a
  finding's weight, for the scan's reason (§6.2): a check that did not answer is
  not a check that passed, and the line is rendered even when the pull request
  itself could not be read — a CI line that disappears reads as a clean one.
- Verification and acceptance run only for a run that finished. A failed run has
  nothing to verify.
- `core` is at 106 exports against a ceiling of 100 (ADR 0029). The deletion
  pass named 22 candidates in ADR 0030; the decision on them is still open.

## Alternatives considered

- **Poll CI until it settles.** Rejected: review would block on somebody else's
  build. "Still running" is a true answer and the human can ask again.
- **Store the pull request number on the node.** Rejected: it is derivable from
  the branch, and a stored one is a field to forget — the same reasoning that
  keeps status derived (§3.2).
- **Run verification inside the agent's own session.** Rejected: the run being
  judged would be running its own judge, and ADR 0019's rule is that anything
  governing how a result is judged comes from the base.
