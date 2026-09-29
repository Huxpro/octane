---
'@octanejs/lynx': patch
---

Present native event `target`/`currentTarget` elements in main-thread handlers
as `MainThread.Element`, the same value a mounted `main-thread:ref` holds.
