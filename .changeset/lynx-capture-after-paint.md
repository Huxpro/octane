---
'@octanejs/lynx': patch
---

Describe the first tree after the frame it describes, on the receivers that can.

A synchronous first screen runs `render` → `publish` → `capture` → `announce`
with nothing between the entry's call and the browser's next frame, so all four
sit inside the paint window. Only the first two produce it: `capture` validates
the painted tree and builds the description the background clones when it
adopts, and nothing on the paint path reads either. On a 10,000-row page it is
about 164 ms per screen, comparable to `publish` itself.

An engine-lifecycle receiver — `firstScreenRender: 'engine'`, which is native —
now publishes the frame and takes `capture` and `announce` in the next task. The
order does not change: they are the same two phases in the same sequence against
the same source, run from one shared body so the two entry points cannot answer
differently, and `announce` still waits for `capture` because
`canAnnounceReady()` already withholds the reply while the screen is unpainted.
A correlated ready request that lands in the gap therefore waits and is answered
by the capture that was already scheduled — never a partial tree, never a second
one built to answer it.

Everything that reads what capture produces brings it forward instead of finding
nothing: a tap resolving its first-tree target, `firstScreenSnapshot()`, an
inbound commit, unmount, and receiver close. `null` from `firstScreenSnapshot()`
keeps meaning "no synchronous first screen was painted".

Two paths decline the deferral rather than approximating it. An immediate-mode
`root.render()` returns the capture verdict to its caller — `null` for a tree the
background cannot adopt, a throw for one that cannot be captured — so it keeps
capture in front of the paint; this is what Lynx for Web uses. And a receiver
with no macrotask rung captures inline, because a microtask drains before the
host can paint and would move the work without taking it out of the window.

New option `scheduleFirstScreenCapture` chooses that rung: it defaults to the
ambient `setTimeout`, takes a host's own "the frame is on screen" callback, and
takes `null` to decline the deferral outright.
