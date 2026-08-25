---
'@octanejs/lynx': patch
---

`@octanejs/lynx/compiler` is a new export: the Lynx backend that turns a host
template program into straight-line main-thread source, so a first screen can be
painted by compiled code instead of by an interpreter walking a program at run
time.

`emitLynxMainThreadProgram(program, { name })` returns the source of a function
that takes the normalized Element PAPI and returns a create function
`(pageId, parent, v0..vN, e0..eM)`. That function does what the dense
`mount-template-run` applier does, in the same order — every node created and
given its props, then every event site installed, then every child appended to
its parent, then the root appended once into the caller's tree — with the
per-node dispatch already resolved at build time.

It emits against the normalized PAPI rather than the raw element globals so the
emission and the applier are two implementations of one interface, and one
program can be run through both against the same host and the painted trees
compared. They agree about everything the user sees, including the parts of
`applyDenseScalarHostProps` that look like details: `className` shadows `class`
by presence rather than by value, a class coerces from a number only when
truthy, an empty class writes nothing, and a binding overrides a static prop of
the same name. They differ in exactly one place, by design: the emitted program
writes no nodes-ref selector, because its caller already holds the nodes it
created and nothing has to be findable by CSS selector afterwards.

The backend refuses what it cannot emit faithfully, naming the prop, node or
event site: anything only the general prop-patch path writes (inline styles,
datasets, arbitrary attributes, CSS scope, worklets), host types it cannot
construct, and every program invariant the applier enforces at mount time.
A refusal is a build error rather than a first screen that differs from the one
the command path would have painted.
