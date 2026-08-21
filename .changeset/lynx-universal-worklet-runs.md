---
'@octanejs/lynx': patch
'octane': patch
---

Mount a keyed Lynx list whose rows bind a `main-thread:` prop through one
template run instead of a create per host.

A row carrying any `main-thread:` prop used to cost the whole list its template
program: the compiler declined a program for the list and the core refused the
binding, so a 1,000-row list mounted in 6,002 commands where the same list
without the prop mounted in 3. It now mounts in 3 at either scale.

- `octane` compiler: a keyed row stays program-eligible when it *binds* a
  `main-thread:` prop. A worklet and a main-thread ref are produced by the setup
  body and bound per instance, which is exactly what a program slot is; a
  literal `main-thread:` prop is still refused, because a worklet never arrives
  as one.
- `octane` universal core: a program slot whose binding names a
  renderer-namespaced prop may carry a value the core forwards without
  interpreting, and the renderer's driver validates it. Every other slot is
  scalar-only as before, so the same value in a plain slot still declines the
  program. `UniversalHostTemplateProgramOpaqueValue` is now `object` rather than
  a record of unknown fields: a renderer's descriptor is a declared interface,
  which TypeScript gives no implicit index signature, so the record form made
  the escape hatch unusable by the renderers it exists for. Reading a field off
  one now requires narrowing to the renderer's own descriptor type first, which
  is what a renderer does anyway.
- `@octanejs/lynx`: the worklets a template run carries are bound to background
  executions at the transport boundary, the same step a `create` already took,
  and ownership is recorded per host rather than per command. One run installs
  callbacks on many hosts, and each host's later `update` replaces its own and
  its `destroy` releases them, so removing one row cannot take another row's
  handler down with it.
