---
'octane': patch
---

Give a compiled main-thread program its first-screen IDs and listener bindings.

The `target: 'lynx'` main-thread compile emitted a program carrying only plan-slot
indices. It now carries how many hosts its create function makes, where each keyed
range sat in the plan's pre-order, and each event site's node, host event type and
dispatch priority — every one of which has a reader in this change.

`UniversalProgramPlan` gains `nodes`, `UniversalProgramRange` gains `id`, and
`UniversalProgramPlan.events` is now `UniversalProgramEvent[]` rather than
`number[]`.

The Lynx first-screen renderer freezes a program instead of refusing it, and
numbers it exactly as the interpreted encoding numbers the same source: a hole's
members are numbered where the hole was, so every ID after the first hole agrees
across the two encodings, and so does the whole event envelope. Painting is not
in this change — a first screen holding a program has no command batch, and the
direct applier says it cannot mount one yet rather than walking past it.
