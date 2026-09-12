---
'octane': patch
'@octanejs/lynx': patch
---

Retain shifted keyed component-row descriptors when the compiler proves that
their props do not depend on the loop index.
