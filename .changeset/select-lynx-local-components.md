---
'octane': patch
'@octanejs/rspack-plugin': patch
'@octanejs/rspeedy-plugin': patch
---

Select immutable same-module component boundaries for production Lynx Block applications.

Classify only compiler-proved module-root bindings as supported, carry the fact
through typed Rspack metadata, and keep imported, dynamic, reassigned, or
shadowed components on Universal. Lower root and Provider-child component
descriptors without allocating an unaddressable shell program.
