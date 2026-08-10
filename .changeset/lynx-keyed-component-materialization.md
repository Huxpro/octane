---
'octane': patch
'@octanejs/lynx': patch
---

Reduce Lynx keyed-component materialization cost by lazily restoring owner
boundaries only when component evaluation needs them, retaining unchanged
ownerless subtrees across updates, and compacting transport-approved plan
instances before per-host staging and acknowledgement bookkeeping.
