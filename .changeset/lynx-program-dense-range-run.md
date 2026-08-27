---
'@octanejs/lynx': patch
'octane': patch
---

A keyed range whose members are all one compiled main-thread program now mounts
as a single run. The `target: 'lynx'` backend emits a run driver beside the
create function for a program that paints every range site it declares —
`<name>.run(pageId, count, values, events, ranges, out)`, one tight loop over
member-major tables — and the first-screen applier calls it once for the whole
range instead of calling the create once per member. The run it journals carries
no per-member ID table at all: every ID is `firstId + instance * stride + offset`
and every reader answers by arithmetic from it.

The applier recognises a member through however many transparent wrappers it
wears rather than a fixed one. `@for (const row of rows; key row.id) { <Row /> }`
wraps twice — once for the keyed member and once for the component boundary —
and a wrapper makes no node, so the depth is a lowering detail no consumer
should encode. A wrapper holding anything besides the program still declines the
whole span.

The create function's ABI and bytes are unchanged, and a program with a range
site it leaves open emits exactly what it emitted before and mounts one member
at a time.
