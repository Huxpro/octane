---
'octane': patch
---

`universalPlan` now refuses a plan node kind it cannot interpret instead of
freezing it into an empty text node.

Freezing ended in an unguarded `kind: 'text'` return, so any node kind the core
did not recognize became a text node carrying neither a value nor a slot. A plan
the core had not understood rendered as an empty string: no throw, no warning,
nothing missing from the commit to notice, and the same at any depth, because
freezing walks children. A misspelled kind and a kind from a newer compiler were
indistinguishable from content.

Both are now errors that name the kind. A compiled main-thread program — the
`kind: 'program'` node the `target: 'lynx'` backend emits into a main-thread
chunk — gets its own message, because it is not malformed: it is well-formed and
its renderer's main-thread module can paint it, so what needs looking at is
which core the bundle carries, not the plan.
