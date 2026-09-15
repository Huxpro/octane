---
'@octanejs/lynx': patch
---

Keep native events, host refs, and main-thread worklets dormant when a hidden compiled native-list row is physically materialized or recycled, and attach them only when the row becomes visible.
