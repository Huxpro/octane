---
'@octanejs/lynx': patch
---

Let the Lynx compiler backend explicitly emit a direct scalar value-slot setter
beside a compiled main-thread create program. Unused setters leave existing
program output byte-for-byte unchanged.
