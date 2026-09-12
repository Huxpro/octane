---
'@octanejs/lynx': patch
---

Reuse compiler-proven keyed component row descriptors for deletion-only Block
updates. Stable, index-independent survivors now keep their committed keys,
values, listeners, and row map without rerunning the key or row producers.
