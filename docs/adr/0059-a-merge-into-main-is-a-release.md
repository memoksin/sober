# 0059 — A merge into main is a release

- **Status:** accepted
- **Date:** 2026-09-15
- **Refines:** [ADR 0053](0053-a-release-is-staged-for-a-human-and-what-it-publishes-carries-provenance-and-a-tag.md), [ADR 0007](0007-the-cli-is-published-as-a-bundle.md)

## Context

Day-to-day work lands on `dispatch.base` (`development` here). Nothing tied a
merge into `main` to a version bump. `changeset status --since=origin/main`
passes when any changeset exists, including one already on `main`, so a
release could ship with no bump named for it.

Per-node changesets were tried and dropped: every agent had to name patch,
minor or major for work that publishes nothing on `development`.

## Decision

- Nodes land on `dispatch.base`. Reaching `main` is a separate act the user asks for.
- A merge into `main` is a release. It names one bump: **patch**, **minor** or **major**.
- A node never writes a changeset. A node publishes nothing.
- The bump is asked once, at the merge into `main`, by the person releasing.
- CI enforces it on pull requests into `main` only:
  - `changeset status` must pass;
  - the pull request must add a `.changeset/*.md` file bumping `@besober/cli`;
  - on failure, CI prints how to name the bump.
- After the version moves, ADR 0053 takes over: the version pull request and the staged publish.
- `@besober/cli` is the only published package (ADR 0007), so only its bump counts.

## Consequences

- One question per release instead of one per node.
- Cost: the bump is chosen far from the change. A breaking change buried among
  twenty nodes is easy to bill as a patch. Someone has to read the whole range.
- The gate catches: no changeset added, or one that bumps no published package.
- The gate does not catch: a wrong bump. Whether patch was honest is a human call.
- Renovate and `changeset-release/*` pull requests are exempt, as before.

## Alternatives rejected

- **Per-node changesets.** Asks agents to guess a bump for unpublished work.
- **A `sober release` command.** Invites a session to run it. A human pressing merge is already the trigger.
- **Relying on `changeset status` alone.** Passes on a leftover changeset from `main`.
