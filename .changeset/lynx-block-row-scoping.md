---
'@octanejs/lynx': patch
---

Scope a Block-core re-render to the rows that changed.

A compiled component lowered onto the Block core re-rendered every row of every
keyed range whenever the page re-rendered, then handed the whole next list back
to the keyed reconciler. That is correct, and it is what the list's size costs:
an application keeps its rows in a cell the page owns, so selecting one row of a
table re-rendered every row and visited every block to write the one that
changed.

Two things now decide otherwise, and both answer a question the render was
already asking. A row authored as `<Row … />` is a component call with a props
object, so a row whose component and props are unchanged since the last applied
render is not called again — the memo the universal core applies to that same
shape, with the same comparator. And a render whose key sequence is the one
already mounted has mounted, removed, and moved nothing, so there is no
reconcile to run: the rows that were actually called are written by key, one
visit each.

Nothing about the programming model moves. The page still re-renders, the
trigger granularity is unchanged, and a range that mounts, removes, or reorders
a row still goes through the keyed reconciler, which is the only thing that can
decide survivors. A row authored as an inline `@for` body is never retained:
there is no props object between the range and the row's values, so nothing can
stand in for calling it.

`LynxBlockCore` gains `writeKeyedValues`, which writes every slot of one row by
key in a single visit and returns the block it wrote, for a caller that knows a
row's whole next value array rather than which slot inside it moved.
