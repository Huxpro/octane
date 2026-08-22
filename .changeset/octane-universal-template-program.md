---
'octane': patch
---

Extract the universal plan → template-program lowering onto its own subpath,
`octane/universal/template-program`.

Turning a compiled plan into a `UniversalHostTemplateProgram` — the node list,
the static props, the value-slot and event-site maps a `mount-template-run`
carries — was a private method on the universal root, so the only way to reach
it was to instantiate the whole core. A renderer that deliberately does not
carry the universal core, such as the Lynx Block core, therefore had no way to
perform the lowering except to reimplement it, which would have made the
meaning of a plan a thing two modules disagree about.

The new subpath exports the lowering (`compiledUniversalTemplateProgram`,
`prepareUniversalTemplateProgram`, `prepareUniversalTemplateProgramValues`) plus
the host encoder it is defined in terms of (`createUniversalHostEncoder`), and
the universal root now calls it rather than owning it. The subpath imports no
value from `universal-core.js`, so importing it does not pull the core in.

No behavior change: the collapsed-template path produces the same programs, the
same values, and the same refusals, and `hasCrossRealmPlainPrototype` is still
exported from `octane/universal/native`. One dead field is gone with the move —
the prepared program built a `sharedNodes` array that nothing had ever read.
