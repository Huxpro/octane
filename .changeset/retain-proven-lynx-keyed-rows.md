---
'@octanejs/lynx': patch
---

Reuse compiler-proven keyed component-row descriptors when their item, index,
captures, and selected state are unchanged, avoiding background work for rows
that an immutable list update or reorder leaves untouched.
