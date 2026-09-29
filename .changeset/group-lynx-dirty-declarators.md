---
'octane': patch
'@octanejs/lynx': patch
---

Keep compiler-proved Lynx Block dirty computations active when multiple state
hooks or derived bindings share one `const` statement. Replay bodies now copy
only the required declarators, so hook calls and unrelated calculations do not
run during a local binding update.
