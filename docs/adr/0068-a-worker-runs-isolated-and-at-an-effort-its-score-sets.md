# 0068 — A worker runs isolated, and at an effort its score sets

- **Status:** accepted
- **Date:** 2026-09-26
- **Refines:** DESIGN §5.1, ADR 0058, ADR 0060
- **Evidence:** `docs/RUN-COST-TODO.md` (baseline, W1–W3)

## Context

A headless `claude -p` worker loaded the operator's whole `~/.claude`: the global
CLAUDE.md, user hooks, six MCP servers (Gmail, Drive, Calendar among them), nine
plugins and 71 tools. Measured on sonnet, that is ~8k tokens of context on every
turn, and a run is 50–96 turns. It also leaked into behaviour: a worker answered
in the operator's language, and a worker could write to the board through the
sober MCP server.

Every worker also ran at the operator's own `effortLevel` (`high` here), whatever
the node was.

## Decision

- **A Claude worker starts without the operator's environment.** The adapter adds
  `--strict-mcp-config --setting-sources project,local --settings
  '{"enabledPlugins":{…}}'`. The project's `.claude` settings still load.
  `dispatch.plugins` lists the plugins a worker keeps (default `[]`); `null`
  turns isolation off and keeps today's behaviour.
- **Not `--bare`.** It reads only `ANTHROPIC_API_KEY` and never the OAuth login
  that DESIGN §5.1 relies on. **Not `--disable-slash-commands`:** `jevSkills`
  needs skills.
- **Effort comes from the node's score.** `dispatch.effort` defaults to `"auto"`:
  the score's tier under `dispatch.thresholds` maps `low → low`, `mid → medium`,
  `high → high`. An unscored node gets no flag. A fixed level applies to every
  run; `null` passes nothing. Claude takes `--effort`; Codex takes
  `-c model_reasoning_effort=…`, with `max` capped to its `xhigh`. The run
  record keeps the effort.
- **Workers cannot publish or change Git state.** Claude's `--settings` adds
  deny rules for `git push`, `git merge`, `git switch`, and `gh pr merge` through
  Bash and PowerShell. `dispatch.workerSettings` may add settings, but cannot
  remove these denies. The rules were checked under `bypassPermissions` too.

## Consequences

- The operator's user-level hooks (for example an output-compressing PreToolUse
  hook) no longer run in workers. Hooks supplied through `--settings` did not
  fire in a CLI check; put worker hooks in project `.claude/settings.json` or a
  plugin. A worker that needs a plugin gets it by name.
- Isolation drops `effortLevel` from user settings, so "auto" is the default, not
  an option. Its saving is not proven yet: one single-task test showed no clear
  difference. The run record's `usage` (ADR 0069) is what decides whether the
  mapping stays.
- Codex, OpenCode, Cursor and Cline are not isolated here. They read their own
  configuration, and no measurement shows a problem there yet.
