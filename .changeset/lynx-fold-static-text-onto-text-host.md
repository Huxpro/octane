---
'octane': patch
'@octanejs/lynx': patch
---

Fold a compile-time-known text child onto a host that accepts the text itself.

A `<text>` whose only child is authored text used to compile to two elements: the
`text` host and a carrier holding nothing but the string. On a renderer that
accepts the same string as a `text` prop, the carrier is a second element
created, addressed, retained, and torn down to say what its parent could have
said. The compiler now writes the string as a prop and emits no carrier, and the
Lynx renderer opts in by declaring the `text-child-prop` capability and listing
`text` among the props its `text` host accepts.

The fold is deliberately narrow. It applies only to a lone child that is authored
text, so a dynamic hole — whose value the compiler does not know and whose slot
the renderer must still address — keeps its carrier, as does a carrier standing
beside a sibling or a host that already writes `text` through a binding or an
unordered prop bag.
