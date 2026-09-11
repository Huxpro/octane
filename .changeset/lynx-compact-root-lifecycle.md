---
'@octanejs/lynx': patch
---

Carry native page destruction over the compact compiled-program wire, cancel roots that unmount before compact readiness, and settle closed-root teardown locally after the native lifetime ends.
