---
'@octanejs/lynx': patch
---

Validation diet (lynx-perf #6): production builds keep envelope validation and
every load-bearing check, but compile the per-command/per-handle/per-snapshot
structural walks and the whole-tree prepare check pass out, cutting main-thread
prepare cost roughly 3.8× on the 10k-row rig. Development and test builds keep
every check, and a corrupt commit in production still rejects loudly through the
staging guards and the apply-time fault path. The profile hook gains
`prepareCheckMs`, the development-only check share of `prepareMs`.
