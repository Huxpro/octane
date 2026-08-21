---
'@octanejs/lynx': patch
---

Build a native `<list>` through direct first-screen emission, instead of sending
every page holding one down the staged batch path.

The direct applier writes the rendered record tree straight to the Element PAPI —
no command batch, no prepared operation list, no cloned record maps. It refused
any tree containing a `<list>`, which was the right call while such a page could
not be adopted anyway. Now that it can be, that refusal was the remaining cost on
exactly the pages a fast first screen is for.

A `<list>` is the one host that breaks the applier's shape twice over. Its
element does not come from `__CreateElement` but from `__CreateList`, with the
three recycling callbacks passed at creation. And its rows are not attached to
it: the platform materializes a row when it needs one, so the walk records every
row and its descendants without creating anything, exactly as the staged path
skips those `create` operations.

The list's element is still created on the way down, where its unique ID lands in
the same order the staged path assigns it — a list whose element were created
after its subtree would hand a later sibling the lower ID. Only the row metadata
waits for the way back up, because it is read off records the walk has not
created yet.

Two trees still take the staged path: one whose host offers no `__CreateList`,
because a page that cannot build a `<list>` at all is owed that diagnostic rather
than a silent fallback, and one whose list topology the applier will not start
building. The second is the important one. Emitting as it walks means it cannot
discover a malformed list halfway and stop — that leaves a half-painted page,
which is the one state the staged path never produces — so it runs the real
validators over the tree first and hands anything it cannot vouch for back, with
nothing created and the diagnostic raised from where it has always been raised.

At 1,000 rows the first screen goes from a median 42.5 ms to 29.5 ms, the two
distributions disjoint across three passes each, and at 50 rows from 3.1 / 2.9 ms
to 2.3 / 2.5 ms over two passes each. Element PAPI traffic is identical in both
arms at both sizes — 21 calls — which is the point: what this removes is Octane's
own staging, not one host call.
