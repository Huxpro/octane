---
'octane': patch
'@octanejs/lynx': patch
---

Let compiler-proved keyed selections revisit only the old and new rows on the
Lynx Block core. The specialization requires the same iterable, unchanged
non-selection captures, a directly forwarded item prop, and an immutable local
row-component binding; every other shape keeps the existing full-range path.
