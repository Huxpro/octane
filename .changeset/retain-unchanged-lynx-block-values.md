---
'@octanejs/lynx': patch
---

Reuse compiler-proven unchanged keyed Block row values across structural list
updates. The component core now sends its existing changed-row index proof to
the keyed reconciler, avoiding redundant value callbacks and slot comparisons
for retained survivors while preserving conservative hand-written behavior.
