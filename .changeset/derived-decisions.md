---
'@besober/cli': minor
---


Planning in a repository that has already made its architectural choices no longer asks them from scratch. `plan` reads `docs/adr/`, `CLAUDE.md`, the dependency manifest and the directory layout, writes what the project already chose as an option, and records where it read it in a new `derived` field. The question still goes to the human one at a time, and the answer says it was confirmed rather than arrived at (ADR 0055).
