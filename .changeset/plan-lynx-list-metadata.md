---
'@octanejs/lynx': patch
---

Cache native-list descriptor metadata per resident template so logical rows read only dynamic list metadata instead of copying props and reinterpreting unrelated bindings.
