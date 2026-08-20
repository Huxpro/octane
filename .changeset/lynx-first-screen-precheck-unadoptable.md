---
'@octanejs/lynx': patch
---

Decline a first screen the background cannot adopt before painting it, instead
of after. A page holding a native `<list>` built its whole command batch,
created a host container, ran the staged prepare and apply, planned the native
list, failed adoption capture, and tore all of it back out — to reach a verdict
that never depended on any of it having happened. The renderer's record tree
already carries every element type and prop the verdict reads, so the question
is now asked there, and a page whose answer is "decline" retires with no
container and no host traffic at all.

At 1,000 native rows (4,002 logical hosts) the synchronous first screen goes
from a median 37.8 ms and 18 Element PAPI calls to 5.1 ms and none, the two
distributions disjoint across four base and three head passes of 21 samples.
Almost none of the removed cost was host traffic: an unscrolled native list
creates no cells, because the platform materializes rows through the recycling
callbacks. It was Octane's own work — the batch, the container, the prepare and
apply walks, the list plan over 1,000 descriptors, the capture, and the
teardown. What remains is the render that produces the records the verdict
reads.

A list-free page pays only the walk, 0.063 ms median over that same 4,002-host
tree, or 0.06% of its ~108 ms first screen, and its host traffic is unchanged.

What compiled pages look like decided the shape of the walk. `<list>` lowers to
a `template` create program rather than a `host` plan node, with its rows in one
child hole as a keyed `@for`; the record tree that renders is `host <list>` over
one range per row, each holding one `host <list-item>`. So the template-created
list still reads as an ordinary `list` host — and ranges have to be transparent,
because the rows are not the list's own children. A reader stopping at the
immediate children would validate an empty list, decline, and swallow every row
defect on the way, while still passing a decline test. Both walks are also
iterative, because a range chain is a chain of nested directives and nothing in
the first-screen pipeline may cap a depth the renderer accepted.

The pre-check answers `true` only for a tree the staged path would have
accepted, because skipping a build must never skip a diagnostic. It runs the
real `createLynxListItemDescriptor` and `planLynxListUpdate` over the same nodes
rather than restating their rules, so a malformed child type, a missing or
non-string `item-key`, a bad `reuse-identifier`, `recyclable`, or `defer`, and a
duplicated `item-key` all keep being reported from where they are reported
today; so do the prepare walk's nested-`<list>` and `<list-item>`-placement
rules, which it tracks alongside. A host that offers no list PAPI is not a
decline either: without `__CreateList` the page cannot build a `<list>` at all,
and that is a diagnostic the application needs rather than a page to skip.

`captureLynxFirstTree` remains the authority on adoption. A shape the pre-check
does not claim still settles exactly as it does today, having paid for the
paint.
