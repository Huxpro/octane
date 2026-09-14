---
'@octanejs/lynx': patch
---

Cache compiled native-list descriptors per logical row so child binding updates and structural moves do not reinterpret static item metadata for every list member.
