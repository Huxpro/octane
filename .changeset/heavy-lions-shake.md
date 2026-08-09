---
'@octanejs/lynx': patch
---

Production builds keep envelope validation and every load-bearing check, but
compile the per-command, per-handle, per-snapshot structural walks and the
whole-tree prepare check pass out. Development and test builds keep every check,
and a corrupt commit in production still rejects loudly through the staging
guards and the apply-time fault path. The profile hook gains `prepareCheckMs`,
the development-only check share of `prepareMs`.
