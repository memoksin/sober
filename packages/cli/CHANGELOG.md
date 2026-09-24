# @besober/cli

## 0.2.0

### Minor Changes

- 0d73ceb: Planning in a repository that has already made its architectural choices no longer asks them from scratch. `plan` reads `docs/adr/`, `CLAUDE.md`, the dependency manifest and the directory layout, writes what the project already chose as an option, and records where it read it in a new `derived` field. The question still goes to the human one at a time, and the answer says it was confirmed rather than arrived at (ADR 0055).

## 0.1.1

### Patch Changes

- 70307e6: The install is 60% smaller: the source map is no longer published.
  
  The bundle shipped with `dist/sober.js.map` beside it, on the assumption that
  it made stack traces readable. It never did — Node does not read a source map
  unless it is told to, and nothing told it. So every install downloaded 0.83 MB
  that nothing on the machine could use.
  
  `npm i -g @besober/cli` now pulls 0.54 MB instead of 1.36 MB. Nothing else
  changes: the map is still built, it just stays in the repository (ADR 0054).

## 0.1.0

### Minor Changes

- adfbf42: The first release worth installing.
  
  SOBER plans work as a graph, holds every node that depends on an unanswered
  decision, and dispatches an agent into the ones that are ready — through the
  host CLI you already installed and logged into. It never asks for an API key
  and never picks the model.
  
  `npm i -g @besober/cli`, then `sober init` in a repository. The board is files
  on an orphan git branch, so it travels with the repository, merges field by
  field rather than line by line, and needs no server, no account and nothing
  hosted.
  
  The same product runs inside a session: `sober mcp` is the MCP server, and
  there is a plugin for Claude Code, Codex, OpenCode and Cursor that brings it
  with six skills — plan, decide, brief, next, distribute, and the loop itself.
  Four hosts can be dispatched to; Claude Code is the one you can also talk to
  while it works.
  
  **Why 0.1.0 and not 1.0.0.** The loop is gate-tested end to end on a real
  repository, three times. The four newest features are not: the auditor, chain
  claim, AI distribution and the Cursor adapter have code behind them and no
  hand-run gate, and no live Cursor session has ever driven a dispatch. The
  command surface may still move, and 0.x is what says so honestly.
