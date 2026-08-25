---
'octane': patch
---

Declare the compiled main-thread program plan the `target: 'lynx'` backend emits.

`octane/universal` and `octane/universal/native` now export
`UniversalProgramPlan`, `UniversalProgramRange`, and `UniversalSlotKind`, and
`UniversalPlanNode` carries the program. Both universal cores refuse a program
by type rather than by a widened read of `.kind`, so the tail of their kind
chains is a program and nothing else — a kind added to the union without a
branch stops compiling, which is the failure the previous release's silent
empty-text fall-through used to answer by painting nothing.

`UniversalTemplatePlan.slots` is typed `readonly (UniversalSlotKind | null)[]`
rather than `readonly (string | null)[]`. The same compiler pass builds both
tables, and a slot kind selects which operation may write the slot, so a bare
string table put the dispatch back in doubt. Reading a plan is unaffected;
a hand-built template plan whose slot kinds are typed `string` needs the literal
kinds, which its doc comment had never named in full — `c`, `r`, `p:<name>`, and
`e:<name>`.
