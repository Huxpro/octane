---
'octane': patch
'@octanejs/lynx': patch
---

Update only changed item identities when a compiler-proved Lynx keyed component
list receives a same-order replacement array. Direct key properties are read
once before row work, structural changes retain the complete keyed reconciler,
and retained scalar wire values skip redundant host encoding.
