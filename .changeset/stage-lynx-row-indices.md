---
'@octanejs/lynx': patch
---

Publish retained keyed-row indices after a structural commit instead of copying
every shifted survivor while constructing the next background render.
