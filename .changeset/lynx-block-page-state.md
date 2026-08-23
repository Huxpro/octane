---
'@octanejs/lynx': patch
---

A component with state now renders on the Lynx Block core.

Deriving a program from a compiled component landed without a hook layer, so a
`core: 'block'` bundle refused any setup that called one — which is most real
pages, and which left the hand-written fixture as the only way to exercise the
core end to end. That refusal is gone for the page component: its setup runs
inside a `createUniversalHookScope`, so the cells are the universal core's own
rather than a second implementation of them, and a setter it hands to a tap
repaints the page. A handler that writes two cells produces one frame.

A hooked *row* of a keyed range is still refused, and the diagnostic now says
so precisely rather than claiming the core has no cells at all. Rows render
outside the page's scope, and a scope per row is an owner per row — the
per-component cost this core exists to avoid — so whether a row can afford one
is its own question with its own measurement. Effects and context reads are
refused at both levels: an effect needs a commit phase this core does not have,
and a context read needs an owner chain a single scope does not build.
