---
'@octanejs/lynx': patch
---

Stop a native list's commits scaling with the square of its rows when its rows have more than one shape.

A `<list>`'s rows are declared by runs, and a run covers a contiguous span of one
row shape — so a keyed `@for` with two branches declares one run per row for a
feed that alternates between them. Resolving a declared host scanned every run,
and the per-commit walk that tells a list about its rows does that once per row,
which made each commit quadratic in the row count. Runs are now kept ordered by
their first host id and looked up by binary search.
