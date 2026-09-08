# 0053 — A release is staged for a human, and what it publishes carries provenance and a tag

- Status: accepted
- Date: 2026-09-08
- Refines: ADR 0007, `BUILD-PLAN.md` §10 (phase 3 row)

## Context

`BUILD-PLAN.md` §10 marks provenance and trusted publishing **done** in phase 3, and lists the three things the release workflow carries: `id-token: write`, `NPM_CONFIG_PROVENANCE`, and an npm new enough to mint its own credential. All three are there. Two of them were never reached.

`@besober/cli@0.1.0` went to the registry on 2026-09-08. Its record has `dist.attestations: null` — no provenance. The release log gives the reason in one line:

```
[WARN] Skipped setting provenance: ERR_PNPM_PROVENANCE_INSUFFICIENT_INFORMATION:
The environment does not provide enough information to determine visibility
```

The publish is not npm's. `pnpm release` is `pnpm publish --recursive --access public --no-git-checks`, so pnpm publishes and pnpm's own provenance path runs — the one that first asks how visible the repository is, fails to answer on a repository that is plainly public, and skips. npm's path, which generates the attestation automatically for a public package in a public repository under trusted publishing, was never asked. The `npm install --global npm@latest` step upgrades an npm that then does not publish.

The same substitution took a second thing with it. `git tag -l` is empty. Changesets creates a package's tag as part of publishing; with `pnpm publish` standing in for `changeset publish`, that step has no one to run it, and the action's tag push is keyed on output the substitute does not print. So there is a version on the registry and nothing in the repository that says which commit produced it — the one artifact provenance exists to make checkable, missing from the side a human reads first.

The third item has not gone wrong yet, and is the reason to touch this at all. The trusted publisher is configured with `--allow-publish`: every push to `main` that leaves no changeset pending publishes to the registry unattended. npm's staged publishing exists for exactly this shape — CI runs `npm stage publish` without 2FA, and a maintainer runs `npm stage approve <stage-id>` with it. Turning `--allow-publish` off is what makes the guarantee real, and it cannot be turned off while the workflow depends on it.

The three are one change because they are one line: the release script.

## Decision

**Publishing goes back to npm.** The release script calls the npm CLI rather than pnpm's publish. Provenance then needs no flag at all — trusted publishing generates it — and `NPM_CONFIG_PROVENANCE` stays as the statement of intent for anyone reading the workflow.

**A version is staged, and a human releases it.** CI runs `npm stage publish`; the maintainer approves with 2FA. The trusted publisher is then reconfigured to `--allow-stage-publish` without `--allow-publish`, so an unattended publish stops being possible rather than merely being avoided.

**The tag is its own step, and the release script pushes it.** `changeset tag` reads the versions the repository already carries and tags them; `.changeset/config.json` already sets `privatePackages.tag: false`, so only `@besober/cli` gets one, and `@changesets/git` writes it with `-m`, so it is annotated rather than lightweight.

Pushing it is the script's job rather than the action's, and that is not a concession to staging. `changesets/action@v1` decides whether anything was published by reading `New tag:` lines out of the publish command's stdout — a line `@changesets/cli@3.0.1` no longer prints. It says `Created git tags:` now. So the action's tag push and its GitHub release are already unreachable on this repository whichever command publishes, and `git push --tags` in the script is what replaces them. This is what makes the choice below cheap: the convenience staging gives up was not running.

**0.1.0 is tagged retroactively, and stays unattested.** The tag `@besober/cli@0.1.0` is created on `24324ab` — the commit whose `package.json` said `0.1.0` — because a tag is a claim about which commit produced a version, and that claim is knowable. Provenance is not: an attestation cannot be minted after the fact for a tarball already on the registry, and republishing 0.1.0 is not possible. The first attested version is the next one.

**Staging twice has to be a no-op, so the script does the checking.** `changesets/action@v1` runs the publish command on *every* push to `main` that leaves nothing pending — its assumption is that a publish command skips what is already published, which is true of `changeset publish` and false of `npm stage publish`. Left alone, the first commit after a release would turn the release job red with "cannot publish over 0.1.0" and mean nothing by it. So `pnpm release` is `scripts/release.mjs`: it asks the registry whether this version is there, stages it only if it is not, and tags either way.

### The alternative, and why it lost

`changeset publish` fixes provenance and the tag in one command, and is the shorter script. It cannot stage. Choosing it would have meant staging later — when someone other than the author can push to `main` — and leaving `--allow-publish` on until then.

It lost on a measurement rather than a preference. Both of the costs staging appeared to carry turned out not to exist here: the second act is a fingerprint on the owner's Mac rather than a phone and a code, and the GitHub release `changeset publish` would have restored is already unreachable for the reason above. What it still buys is one command instead of three, against a window in which an unattended push cannot publish. Three commands is the cheaper side of that trade.

## Consequences

- `package.json`'s `release` script becomes `node scripts/release.mjs`; `.github/workflows/release.yml` keeps its permissions and env unchanged.
- `BUILD-PLAN.md` §10's phase 3 row loses the word **done**: provenance was configured, not achieved. It gains the version that proves it — the first one whose registry record has an attestation.
- A release stops being a push. Whoever merges the version pull request has to come back and run `npm stage approve`, and the window between the two is a version that exists and is not installable.
- `npm stage list` becomes part of reading the state of a release. A staged version that nobody approves is invisible to `npm view`.
- `@besober/cli@0.0.0` and `@besober/cli@0.1.0` remain on the registry without provenance, permanently. Anyone verifying the chain starts at the next version.
