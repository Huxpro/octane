---
'@octanejs/lynx': patch
---

Derive a keyed range onto the Block core's range site.

A `core: 'block'` bundle could derive a compiled component only while its plan
was one static shape: a `@for` was refused by name, so the one workload the
Block core exists to be measured on — a table whose rows churn — could not be
driven through a derived program at all. That left every list number on this
core coming from a hand-written fixture, which is an architecture floor rather
than a framework measurement.

A range hole is now removed from the template the component mounts and becomes
an `openForSlot` site on the host node that held it. The rows are lowered
through the same plan → wire path as the page, and each render reconciles them
with `reconcileForSlot`, so a reorder moves survivors instead of repainting the
list, and a row that survives is patched slot-wise. Rows written as a child
component are unwrapped and rendered too, since that is how a real page is
authored. Per-row handlers bind, rebind, and release with the rows themselves,
and a row's event hole may be empty for the same reason the page's may — a
conditional handler is a site the render left unbound. A row that withdraws one
is released before it is rebound, so it stops reaching the closure of the
render that last supplied it.

Five shapes are refused by name, each naming the component and the remedy: a
range that is not the last child of its host element, because the core appends
its rows to that element and anything authored after the range would be painted
ahead of every row; a range with an `@empty` block, which needs a second
template; a range nested inside a range; a row that is not one compiled host
template every row of that range shares; and a hole that mounted a range and
later held something else. A refusal happens while rows are being rendered,
before anything is written, so a component that cannot be derived leaves the
core and the transport exactly as they were rather than half-painted with a
frame queued for the next commit.

`reconcileForSlot` also reported no departures when a range reconciled to
empty, so an owner that released per-row resources on departure leaked every
row of the last list it held. Emptying a range now reports its members like any
other removal.
