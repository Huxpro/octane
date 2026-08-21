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

The guard itself was right for the design we have. A native `<list>` does not own
its rows: the platform materializes them through the
`componentAtIndex`/`enqueueComponent` callbacks handed to `listPAPI.create`, and
it owns the resulting cell state. Octane builds those callbacks as per-instance
closures with no cross-thread handle space, so a first tree — a clone-safe
description the background *adopts* — has nothing it can hand over, and skipping
the list's children would not help because the list node is itself the
unhandoverable part.

That is a limit of this design, not an inherent one. ReactLynx's element-template
runtime carries lists across the same boundary by never transferring the callbacks
at all: its hydration payload strips `component-at-index`,
`component-at-indexes`, `enqueue-component`, and `update-list-info`; the callbacks
are installed once as stable identities that read mutable list state rather than
being recreated per update; and what crosses is a serializable descriptor — the
remaining attributes plus item metadata keyed by a stable id shared between the
background command stream, the main-thread registry, and native's list callbacks.
Adopting a list here would mean adopting that shape. Declining is the right
behavior until then, not a permanent verdict.

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
this makes that outcome ordinary and quiet rather than a reported defect.

Both things this fix left open have since been closed, in this same release.

The build-then-discard is gone, and the way there was not the prepared batch
publishing what it staged but the renderer's record tree, which already carries
every element type and prop the verdict reads.

Then the decline itself went. The prediction above — that adopting a list would
mean adopting ReactLynx's shape, a serializable descriptor and stable callback
identities — turned out to be answering a question that was not being asked.
Octane's list state never crosses the wire at all: it is main-local, so adoption
moves it by reference. What it costs is rebinding three closures against the
container being adopted into. A page holding a `<list>` is painted and adopted
now, so the paragraph above describing the synchronous first screen as
unavailable to it no longer holds.

Portals reject capture through the same function and keep throwing. That is not a
half-finished migration: the main renderer rejects a portal while rendering, so
those guards are unreachable from the first-screen path and defend only a direct
call, where a fault is the right report.
