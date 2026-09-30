---
'@octanejs/lynx': patch
---

Reuse detached Element Template instances across later logical mounts. Lynx 4.1
keeps removed text shadow nodes in Android's JNI weak-global table, so dropping
the detached handles exhausted the 51,200-entry process limit after repeated
create/clear cycles. Rebinding every mutable value, event, and visibility slot
keeps native allocation bounded while preserving fresh Octane instance and
listener identities.
