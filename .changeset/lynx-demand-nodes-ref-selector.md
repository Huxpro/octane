---
'@octanejs/lynx': patch
---

Install a `nodes-ref` selector only where a public instance was requested, and
keep it with the host across native-list recycles.

The main thread used to write a selector onto every native `<list>` cell node,
clearing and reinstalling it on every recycle. Three places also installed one
as a side effect of asking an unrelated question: publishing a handle for an
updated host, resolving a first-screen native event target, and filtering the
attachment stream — the last of which asks about every node of every cell on
every recycle.

A record now carries a sticky request bit alongside its per-node installed bit,
set by `ensure-public-instance` and by `getPublicInstance`. The list cell paths
install only for hosts that asked, the enqueue-time clear only clears what was
installed, and the three predicates use a new non-installing `getLynxHostHandle`.

A request made while a cell is detached survives until that cell is
materialized, so a row queried before it scrolls into view still answers, and a
row that moves to a different physical cell keeps answering there. Rows nobody
queried are no longer addressable by `nodes-ref`, which is what makes the saving
real: one steady-state recycle now costs the slot-write floor exactly — 2
Element PAPI writes on a 3-node row and 3 on a 9-node row, down from 6 and 15.
