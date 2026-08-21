---
'@octanejs/lynx': patch
---

Paint a native `<list>` page synchronously and let the background adopt it,
instead of refusing every tree that holds a `<list>`.

The app shape a fast first screen exists for — a feed — was the one shape that
never got one. What made it look impossible was a measurement nobody had taken:
at first screen a native list has no cells at all. The platform materializes a
row through `componentAtIndex` when it needs one, so a 1,000-row feed paints
exactly one node, the `<list>` itself, and every row is a live record with no
element behind it.

That collapses the problem twice. What is painted is one node, so transfer moves
one node. And the state that cannot be serialized — cells keyed by native sign,
recycle pools, retained items, and the three recycling callbacks — is main-local
and never crosses the wire, so adoption moves it by reference rather than
describing it. Only the callbacks cannot come along, because they close over the
container adoption is about to empty; they are rebound against the target and
installed with `__UpdateListCallbacks`, which is what lets an adopted list still
materialize a row.

No wire format changes. The snapshot keeps `format: 1` and its contract of one
painted physical node each; the unpainted rows live in the main-local journal
beside it. Widening the format would have changed a shape every peer validates
on receipt — a background peer that rejects it never boots — in order to describe
nodes no peer reads.

Adoption of a list proves three things: the painted nodes agree, the list's items
agree, and the platform has not materialized a cell since capture. The last is a
recycling epoch read at capture and re-read at adoption; a list that woke up in
between holds physical state the captured tree does not describe, so the page
repairs rather than adopting a stale picture. A list with no rows at all is an
ordinary page, not a disagreement: its commit carries no list update, because
there is nothing to insert.

Capture now declines only a list that had already materialized a cell. The
pre-check added by the previous change cannot predict that, and it is removed
here rather than left to decline every list page.

Measured on the real first-screen path against the lowering compiled `.tsrx`
produces, with the background stood in for by a second render dispatched over the
real ContextProxy, and every head sample asserted to have actually adopted: a
1,000-row feed first paints at 42.8 ms instead of 70.4 ms, and a 50-row feed at
2.9 ms instead of 5.6 ms. The main thread does more total work for that — 117.1 ms
against 70.4 ms at 1,000 rows — and almost none of it is the comparison: the paint
is 43.2 ms, proving the two trees agree over 4,002 records is 11.1 ms, moving the
physical nodes is 0.8 ms, and the rest is the same record walk the declining arm
also pays. Adoption's Element PAPI overhead is constant rather than per-row: 21
calls against 12 at both 50 and 1,000 rows.
