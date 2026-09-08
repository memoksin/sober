---
'@besober/cli': patch
---

The install is 60% smaller: the source map is no longer published.

The bundle shipped with `dist/sober.js.map` beside it, on the assumption that
it made stack traces readable. It never did — Node does not read a source map
unless it is told to, and nothing told it. So every install downloaded 0.83 MB
that nothing on the machine could use.

`npm i -g @besober/cli` now pulls 0.54 MB instead of 1.36 MB. Nothing else
changes: the map is still built, it just stays in the repository (ADR 0054).
