---
'octane': patch
---

Replay only context-invalidated rows in compiler-proved stable Universal component lists.

The compiler now records a conservative direct-prop dependency proof for local
component rows. Universal roots use that proof to retain a sparse context-to-row
index after an accepted full render, then update only affected row owners without
enumerating the keyed list. Structural changes, effects, suspension, transitions,
opaque expressions, and rejected async transport retain the complete-list fallback.
