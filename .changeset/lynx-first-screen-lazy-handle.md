---
'@octanejs/lynx': patch
---

Stop minting a public host handle for every node of a first screen before it
paints.

A host record has always known its root, id and generation — it just spelled all
three through the frozen public handle it minted to hold them, so every reader
that wanted one number allocated the whole object. Nothing on the paint path
wants the object. The one selector write every painted host takes builds its
`r{root}-h{id}-g{generation}` attribute itself, and never read `handle.selector`
anyway: that field is the CSS *query* form, `[octane-ref=…]`, so the two strings
were never the same string.

The record now names `root`, `id` and `generation` directly, and the direct
first-screen applier builds the same `LynxCompactHostRecord` the compact-ACK path
already used, which mints its handle on first read. Adoption, a `nodes-ref`, an
update or a wire delta each still get one, identical to the eager one and stable
across reads — handle identity is what decides whether a write changed anything.
A 10,000-row page stops allocating 60,002 frozen seven-field objects and 60,002
selector strings between render and describe; `createHandle` leaves the
first-screen profile entirely.
