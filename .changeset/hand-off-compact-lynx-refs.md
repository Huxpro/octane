---
'@octanejs/lynx': patch
---

Let a `main-thread:ref` move between hosts within one compact compiled-program
frame even when the frame names its new host before clearing the old one. The
ref targets the new host, a rejected frame restores the previous owner, and a
ref still claimed by two live hosts when the frame commits is rejected.
