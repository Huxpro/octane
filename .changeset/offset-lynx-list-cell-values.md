---
'octane': patch
'@octanejs/lynx': patch
---

Let capable resident drivers read native-list row values by offset, avoiding per-cell value slices and eventless empty-table allocations while preserving legacy driver compatibility.
