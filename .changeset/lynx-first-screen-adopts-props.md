---
'@octanejs/lynx': patch
---

Stop copying a first screen's host props into a second object before painting
them.

`cloneProps` exists because a host prop bag normally arrives from the other
thread, which is a separate JS realm in production, so the container has to build
data it owns out of values it has proved it can hold. The direct first-screen
path has no such crossing: its bag was built by `universalProps` in this realm,
on this call stack, and frozen at its only construction site. When every value in
it is a scalar there is nothing left to clone and no tagged callable to unwrap, so
the container now holds the bag it was given. A bag that fails any of those tests
— still mutable, reached through a class, holding an object — takes the copy
exactly as before.

The unwrap that turns a `main-thread:` tagged callable into its worklet
descriptor is now asked of a value rather than of a name. A tagged callable is a
function, so it can only appear where the copy already stops to look at a
non-scalar; the pass it replaces walked every key of every bag, and on a
60,002-host page found nothing.

Measured on a 10,000-row page over an interleaved four-round A/B: the publish
phase falls from a median-of-medians of 475.5 ms to 337.9 ms, a 29% reduction,
with the two arms' medians not overlapping.
