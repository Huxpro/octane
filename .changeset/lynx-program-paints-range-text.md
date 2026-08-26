---
'@octanejs/lynx': patch
'octane': patch
---

Paint a compiled main-thread program's text holes in the program itself.

A `.tsrx` template lowers every dynamic child to the same slot node, so a build
cannot tell `{row.label as string}` from a `@for` and the Lynx main-thread
compile declares both a keyed range. The text a row shows therefore went over
the command path even when the rest of the row was straight-line compiled code:
two nodes per row at every row count.

The create function now carries the decision instead. Where a range site's host
can hold raw text, the emission compiles `typeof r === 'string'` — the applier's
own entry condition for that route, which throws rather than coerces on anything
else — and paints the node itself; the site's `paintsText` records that on the
compiled program so the first-screen renderer skips materializing the same node,
numbers the hole where the interpreted encoding numbers it, and hands the string
over instead. A hole holding anything else, and a hole under a `view`, are
unchanged.

The create function's return grows one entry per declared range, holding what it
painted there or `undefined`, and the mount compares that against what it sent:
a hole neither filled would be a text silently missing, and one both filled a
node no ownership journal knows about. The painted node is journalled under the
ID the background will describe it by, so adoption and disposal see it exactly
as they see every other node a program made.

The main-thread backend signature moves to `lynx-main-thread-program/4`.
