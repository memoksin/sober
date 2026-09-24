# sober

## Branch model

- Every change goes to `development` unless the user explicitly says otherwise.
- A PR into `main` is opened only when the user explicitly asks for one.
- A merge into `main` is a release. The user decides when a release happens — never open or merge one on your own initiative.
- Each release names its bump: patch, minor, or major.

## Changesets

- Never write a changeset for a node. A bump — patch, minor, major — is the user's choice at the release, not something a node guesses.
- CI asks for a changeset only on a pull request into `main`, which is the release.
- `@besober/cli` is the only published package. Everything else is `private: true` and ships inside that bundle (ADR 0007).
