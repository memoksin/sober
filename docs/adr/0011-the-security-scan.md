# 0011 — The security scan: `secretlint`, and six named signals

- Status: accepted
- Date: 2026-08-28
- Revised: 2026-08-29 — project configuration is supported, and read from the base (ADR 0019)
- Refines: ADR 0002

## Context

ADR 0002 moved a security scan of every dispatch result into MUST, and the reason holds: "Review with no scan asks a human to spot a leaked key in a diff they did not write."

Three things were left open. No document named a tool — so phase 3 would either find one or hand-roll regexes, and hand-rolling is the reinvention `MANIFESTO.md` exists to prevent. No phase owned it: ADR 0002's consequence reads "Phase 3 (`cli`) **or** phase 4 (`dashboard`)", and "or" is not an owner. And "injection-shaped changes" was never defined — a real injection analysis needs per-language rules, and SOBER's users write in every language. As stated it promised something SOBER cannot deliver.

## Decision

**Secrets: `secretlint`.** A pure-JavaScript npm package with no install script, so nothing is fetched or compiled at install — which is what `PR-00-01` requires. It resolves rule packages by name at runtime, so it is the one dependency the CLI declares rather than bundles (ADR 0007). It also runs in SOBER's own CI, as `SCOPE.md` rule 4 demands of anything SOBER ships.

**A project may configure it, and that configuration is read from the base.**

- With no project configuration — the ordinary case — SOBER's own bundled preset runs. Nobody has to write a file, and the default behaviour is fixed.
- A project that carries a `secretlint` configuration may add rules for its own secret formats and suppress a known false positive. A test fixture holding a fake key would otherwise produce a finding on every dispatch, and a panel that is always wrong is a panel nobody reads.
- **That configuration is read from the base ref, never from the branch under review** (ADR 0019). An agent that relaxes the rules in its own diff does not relax the scan of its own diff; the change is a line the human reads, and it applies only once accepted.

Making the rule set static and un-configurable was the earlier decision here. It was dropped: it cost project-specific secret formats to close a hole that it did not actually close, because the suppressions it still allowed would have lived in a repository file the same agent could edit.

**"Injection-shaped changes" is replaced by six named signals**, each a rule with a test, all language-agnostic:

| Signal | Why it earns a place |
| --- | --- |
| A dependency was added (manifest or lockfile changed) | The highest-value signal on agent output, and free to detect |
| The diff touches files outside the node's declared `files` | SOBER already holds that list; the clearest sign an agent did something unexpected |
| Dynamic code execution was introduced | A short word list, same in every language |
| A shell command is built from a variable | Same |
| TLS verification was disabled | One line, very high signal |
| A new network call to a hardcoded address | Same |

A project with `semgrep` or `gitleaks` installed can run them additionally, by configuration. Not a requirement.

**The scan reads the added lines of the diff**, not the worktree. Scanning the worktree reports everything already in the repository and makes the review screen useless; `PR-09-07` covers what is already there.

**A scanner that cannot run does not disappear.** The review proceeds, "the scan did not run" renders with the weight of a finding, and the fact is written into the `accepted` record. `PR-09-06` requires that a failed scan is "never silently dropped"; a broken scanner is the case that would otherwise slip through.

**Phase: production in phase 3, rendering in M3.** Review cannot ship without the scan, and phase 3 is where the loop closes. The dashboard renders findings above the diff (§6.2); it does not produce them.

## Consequences

- ADR 0002's "phase 3 or 4" is closed.
- What the scan does **not** catch is documented next to what it does. A named short list keeps a promise; "injection-shaped changes" could not. Because the rule set can now differ per project, the review names which one ran.
- The declared-files signal also resolves the contradiction between `DESIGN.md` §3.1, which calls that list a prediction, and the Definition of Done, which enforced it. It becomes a finding in review rather than a closed pull request.
- `secretlint` in SOBER's own CI is a sixth required check, added in phase 0.

## Alternatives rejected

- **`gitleaks` or `trufflehog`.** Both are Go binaries, so both are a separate executable to fetch, against `PR-00-01`. `trufflehog` also verifies findings by calling out to the network.
- **Hand-written regexes.** The reinvention this project rebuilt itself to avoid.
- **A real per-language injection analyser in v1.** Unbounded: one rule set per language SOBER's users might use. The rest of the Auditor stays SHOULD, which is where this belongs.
