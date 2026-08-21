---
'@octanejs/lynx': patch
---

Let the Block background core run behind a main-painted first screen, and add
`@octanejs/lynx/block` as its authoring surface.

A main thread that painted a first screen keeps every optional wire behaviour
dormant until the background's first batch has adopted or repaired that screen,
so intrinsic template runs are unavailable for exactly one commit. The Block
core mounted with `mount-template-run` regardless and had its whole first mount
rejected; it now consults the negotiation per mount and spells that one commit
in the legacy vocabulary, with the same host and listener ids either way.

`compileLynxBlockTemplate` now returns a deeply frozen copy of the program
instead of the caller's object. The wire shares a template program with the main
thread without cloning, and only offers the incremental compact acknowledgement
— the only compact form it will accept after the first batch — for a frozen run,
so a mutable program had its second commit rejected as an unnegotiated compact
acknowledgement.

`@octanejs/lynx/block` exports `withLynxBlockProgram`, `compileLynxBlockTemplate`
and the Block types. The package root cannot serve an application entry here:
`@octanejs/rspeedy-plugin` replaces the bare `@octanejs/lynx` request with the
first-screen facade on the main-thread layer, and an entry is compiled into both
layers.
