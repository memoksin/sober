# 0013 — Board merge mechanics

- Status: accepted
- Date: 2026-08-28
- Refines: D36

## Context

§1.2.1 promises: "The user never sees a conflict marker and never opens a terminal
to fix board state." Nothing said how. Default git behaviour is the opposite — a
conflicted text file gets `<<<<<<<` written into it, and every SOBER surface parses
those files, so the board breaks the moment a marker lands.

D36's wording also confused two granularities: "Record-level is the granularity
people can actually judge; file-level is a diff of JSON nobody wrote." Under
§1.1's rule — one file per entity — record-level *is* file-level. What D36 meant
was **line**-level.

And whole-record choice loses data. If one person edits a node's `notes` while
another edits its `dependsOn`, "which version?" discards one of them. Not silently
— a human chose — but for no reason, and §1.2 rules out this class: "Never
last-write-wins — that is silent data loss."

Two more gaps. Archiving is a rename (§1.2), so archive-versus-edit is a distinct
conflict kind with a distinct question, and it had none. And one file per entity
means two changes can merge **cleanly** into a broken board: a node deleted on one
side while the other adds a node depending on it, or two dependencies that are
each valid and together a cycle. §8.3 refuses a severing delete and §3.6 refuses a
cycle-closing edge, but both checks run locally at edit time. §3.6's own sentence
names the cost: "Enforcing it at the edge is one check; detecting it later is a
class of bug." A merge is a second edge, and it was uncovered.

## Decision

**1. Markers are never written.** `.gitattributes` for the board paths:

```
.sober/nodes/*.json     merge=binary -text
.sober/decisions/*.json merge=binary -text
.sober/archive/*.json   merge=binary -text
```

`merge=binary` stops git attempting a textual merge: the working-tree file stays as
ours, no markers are written, and the path is recorded unmerged with all three
stages available. `-text` stops line-ending conversion, which on Windows would
otherwise produce phantom diffs and a conflict on every line of a merged file.

**2. The three versions come from the index**, never from the working tree:
`git show :1:<path>` (merge base), `:2:` (ours), `:3:` (theirs).

**3. Field-level three-way merge.** A field only one side changed is taken
automatically. A field both sides changed is put to the user, one field at a time.
In the `notes`/`dependsOn` case, nothing is asked and nothing is lost.

**4. Archive versus edit is its own question:** "this node was archived by someone
else while you edited it — keep the archive, or restore it?"

**5. A validation pass runs after the merge, before the commit** — dangling
references and cycles. The merge completes locally so no work is lost, and the
**push is blocked** until the findings are resolved. This reuses `PR-07-02`'s
existing gate rather than adding one.

D36's "file level" is corrected to "line level".

## Consequences

- The promise in §1.2.1 becomes implementable, in about one configuration file and
  three git commands.
- Co-edits on one record survive, so the conflict question is asked only where a
  human genuinely has to choose.
- §3.6 and §8.3 gain a second enforcement point, at the merge, which is the other
  edge their rules assumed.
- All of this needs real git state to test. It is the highest-risk code in `core`
  and the reason ADR 0014 exists.
- The Windows line-ending rule is verified by an integration test on Windows, not
  by reading.

## Alternatives rejected

- **Whole-record choice.** Simpler, and the first proposal. Discards a co-editor's
  work whenever two people touch one record for different reasons.
- **A custom merge driver.** More machinery than `merge=binary` for the same
  outcome: no markers, three stages available.
- **Auto-merging by last writer.** §1.2 already rules it out by name.
