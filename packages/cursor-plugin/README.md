# SOBER for Cursor

The same board, the same tools and the same loop as the Claude Code plugin —
`.cursor-plugin/plugin.json`, the MCP server in `mcp.json`, and six skills.

## Install

From a checkout of this repository:

```
ln -s /path/to/sober/packages/cursor-plugin ~/.cursor/plugins/local/sober
```

Then reload Cursor and confirm the skills and the MCP server under **Customize**.
Local plugin imports have to be allowed, which they are unless a team admin has
turned them off.

`sober` itself has to be on the PATH — `npm i -g @besober/cli` — because that is
the command `mcp.json` names.

## What is different from Claude Code

**No hook enforcement.** Claude Code's plugin denies an agent spawn onto a held
node from inside a session. This plugin ships no hook, so SOBER states the rule
and cannot enforce it in-session. The block itself is unchanged everywhere SOBER
owns the code path: a held node cannot be dispatched from the CLI, the dashboard
or the MCP server.

**No attended dispatch.** `agent -p` takes one message and exits, so a run
dispatched to Cursor cannot be answered while it runs. SOBER refuses an attended
run on this host rather than putting somebody in front of a session that cannot
hear them.

**Decisions can be asked here.** Cursor's MCP client supports elicitation, so
`decide` puts the question on screen rather than refusing — the same as Claude
Code, and unlike Codex and OpenCode.

## Two names, and one that is refused

Set `dispatch.host` to `cursor` or `cursor-agent`. Cursor installs its CLI as
`agent`, which is too generic a word for SOBER to claim: a wrapper script called
`agent` would silently become a Cursor invocation. Name the wrapper after what
it wraps, or give the full path to `cursor-agent`.

## `/loop` is Cursor's, not SOBER's

Cursor ships a built-in `/loop` skill that repeats a prompt on an interval.
SOBER's loop skill has the same name, so type its name in prose or let the model
choose it — do not count on the slash form reaching this one.

## Do not edit the skills here

`skills/` is generated from `plugins/skills/` by `scripts/build-plugins.mjs`.
Edit the source and run `pnpm plugins`; a hand-edited file is reverted by the
next build and fails `test/integration/plugin.test.ts` in the meantime.
