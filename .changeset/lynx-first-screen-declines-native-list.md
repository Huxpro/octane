---
'@octanejs/lynx': patch
---

Decline a synchronous first screen holding a native `<list>` instead of faulting on it.

A first screen containing a `<list>` was rendered in full, rejected at capture,
torn back out, and reported as an uncaught host fault. The page still ended up
correct, because the background root re-rendered it from scratch, so the visible
cost was a main-thread render that was always discarded plus a crash-looking
error — on exactly the app shape a fast first screen exists for. It reproduced on
`examples/gallery`, a faithful port of the official Lynx Product Gallery tutorial,
as `native list materializations cannot be captured as a first tree`.

The guard itself was right. A native `<list>` does not own its rows: the platform
materializes them through the `componentAtIndex`/`enqueueComponent` callbacks
handed to `listPAPI.create`, and it owns the resulting cell state. A first tree is
a clone-safe description the background *adopts*, so a list cannot cross that
boundary — and skipping its children would not help, because the list node is
itself the part that cannot be handed over.

What was wrong is that this was classified as a fault. `captureLynxFirstTree` had
one failure channel, so an unsupported composition and a broken host came out the
same way, and an application using a documented element was told its host was
broken. Capture now returns `null` for a well-formed tree the background cannot
adopt, while every genuine capture fault still throws — a host whose
`__GetElementUniqueID` breaks keeps failing exactly as before. On `null` the
main-thread runtime retires the first screen the way an entry that never rendered
one settles: the nodes come back out so the background does not render beneath a
duplicate, readiness is announced immediately with the same `main-ready` signal,
and no error is raised.

The synchronous first screen is still unavailable for pages containing a `<list>`;
this makes that outcome ordinary and quiet rather than a reported defect. Two
things are deliberately left open. The render is still performed before the
`<list>` is discovered, because nothing knows it is coming until the batch has
been applied — avoiding that needs a static signal from the compiler, which would
not cover dynamically composed trees and so would need this runtime behavior
underneath it anyway. And portals reject capture through the same channel; they
look like the same shape, but no reported case drove this change, so they were
left throwing rather than reclassified on speculation.
