---
'@octanejs/lynx': patch
---

Track each keyed Block survivor's committed position and skip the LIS allocation
when insertions or removals preserve survivor order. Real reorders retain the
existing LIS-based move set, including rejection rollback and retry semantics.
