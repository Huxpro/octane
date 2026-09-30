---
'@octanejs/lynx': patch
---

Compact consecutive equal-slot updates over arithmetic instance sequences into
one SET-RUN frame. The main-thread applier streams the values directly into the
resident slot table, preserving atomic rollback and background-worklet
ownership while reducing list-update framing, parsing, and transfer cost.
