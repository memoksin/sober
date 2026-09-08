---
'@besober/cli': minor
---

The first release worth installing.

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
