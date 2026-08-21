---
'@octanejs/lynx': patch
'octane': patch
---

A Lynx template run can now carry `main-thread:` props, so a list with a worklet
handler mounts in one command instead of falling back to a create per host.

A worklet descriptor is an object, and every other value slot in the template
format is a scalar so a frame can be validated by its header alone. The program
now names which slots a `main-thread:` binding owns, which keeps that property:
the shape is checked once when the program is prepared, a slot bound to `class`
that arrives carrying an object is still the error it always was, and the
descriptor itself is walked by the same validator that already walks a `create`
command's main-thread props. Binding a `main-thread:` prop on raw text is
reported when the template is compiled rather than once per instance.

A worklet slot is compared structurally rather than by identity, because a
compiler rebuilds the descriptor on every render: re-rendering a row with the
same handler and the same captures sends nothing.

`UniversalHostTemplateProgramValue` widens accordingly: a slot may hold a
renderer-namespaced opaque value, which the core forwards without interpreting
and the renderer's driver validates. The core's own program derivation still
produces scalars only.
