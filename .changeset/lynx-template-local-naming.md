---
'octane': patch
---

Name `target: 'lynx'` create-function locals by tree depth instead of a
per-node counter. A host local is live only from its own creation until the
`env.a` that appends it, so siblings can share a name; unique names made every
repeated subtree differ from the last by the bytes of its identifier, which is
what LZ77 matches on, so the gzipped encoding grew without bound in node count.
