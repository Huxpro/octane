---
'@octanejs/lynx': patch
---

The `target: 'lynx'` main-thread backend now emits a run driver beside the
create function for a program whose declared range sites it paints all of —
`<name>.run(pageId, count, values, events, ranges, out)`, one tight loop over
member-major tables. The create function's ABI and bytes are unchanged, and a
program with a range site it leaves open emits exactly what it emitted before.
