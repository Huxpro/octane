---
'@octanejs/lynx': patch
---

Compact the first background render of a native list into resident addressed
program declarations when the main thread has not painted a first tree. Each
component-owned cell remains a dense deferred declaration, preserving logical
ID gaps while removing its expanded create and insert commands from the wire.
