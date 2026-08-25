---
'@octanejs/lynx': patch
---

Decline, rather than fault, a first screen holding a compiled main-thread
program.

`captureLynxFirstTree` returns `null` for a container that painted a program,
on the route it already had for a page it painted correctly and cannot
describe. A capture is a description assembled from records, and a program has
no record for any node it made — that is what a program is, not a gap in one.

The page itself is correct: painted, owned, and torn down completely by
`disposeLynxHostContainer`. What it is not is describable, which is exactly what
this return already means. The caller answers it by retiring the screen as
`skipped`/`unadoptable` and letting the background paint its own, the same
answer an already-materialized native list row gets. Faulting instead would fail
a first screen that is not faulty.

This is the safety net, not the destination: it trades the program's first
screen away. Adoption for a program is slot state off the keyed slot map rather
than a capture walk, and landing that is what makes this branch unreachable.
