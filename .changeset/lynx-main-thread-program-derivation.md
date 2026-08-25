---
'@octanejs/lynx': patch
---

`@octanejs/lynx/compiler` gains `deriveLynxMainThreadProgram(planRoot)`: the
build-time half of the Lynx main-thread backend, which lowers a plan into the
`UniversalHostTemplateProgram` that `emitLynxMainThreadProgram` compiles.

It does not reimplement the lowering. It calls the same
`octane/universal/template-program` functions that the Block core's component
path calls at run time, through the same renderer driver, on the same plan
object the compiler already holds — so a build-time derivation and a run-time
one cannot classify a prop, an event or a dispatch priority differently. The
only thing missing at build time is a container, and the renderer's client
driver already accepts being built without one.

The question a run-time caller has to answer from values — which holes are keyed
ranges — is answered here from the plan's own node kinds. A directive or
component hole is a `kind: 'slot'` node and a content hole is a `kind: 'text'`
node with a slot, which is the same split the compiler's own template lowering
reads. Nothing is evaluated to find it.

A plan the renderer cannot describe as a program returns `null` rather than
throwing: that is the ordinary answer for anything holding a component, a
conditional or a spread of props, and its caller leaves those on the command
path.
