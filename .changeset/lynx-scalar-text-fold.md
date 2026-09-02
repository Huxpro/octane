---
'octane': patch
---

Fold a proved-scalar text hole onto the host that can hold it.

`{expr as string}` as the lone child of a `<text>` now compiles to a `text`
binding on that host rather than to a range site with a carrier element beneath
it. The cast is the form dynamic text already requires, so the shape the
compiler could not otherwise infer is asserted in the source, and the value
reaches the same prop a literal child reaches.

A cast that lies still cannot paint a wrong tree: `text` on a `text` host takes
the carrier's own semantics in every applier, rendering a non-string as empty
rather than coercing it.
