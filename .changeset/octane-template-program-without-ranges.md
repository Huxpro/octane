---
'octane': patch
---

Let a renderer lower a plan whose keyed ranges it owns itself.

`compiledUniversalTemplateProgram` describes every hole in a plan, including a
keyed range, as a node the mounted template carries. A renderer that reconciles
a range through its own list primitive cannot use that: the range's node must
not be in the template at all, or the mount would paint a placeholder where the
rows belong.

`octane/universal/template-program` now also exports
`universalTemplateProgramWithoutRanges(compiled, isRange)`, which returns the
same program with the range holes removed and their host nodes reported, so the
caller can open a range site on each. Only the caller holds the slot values, so
it says which slots are ranges. A range hole that is not its parent's last
child answers `null` rather than a program that would paint a later sibling
ahead of every row, and a plan with no ranges answers with the program it was
given, so the identity-keyed memo in `prepareUniversalTemplateProgram` keeps
answering for it.
