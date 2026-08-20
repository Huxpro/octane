---
'@octanejs/lynx': patch
---

Add the typed, versioned Lynx slot-delta protocol for the specialized renderer.
`RUN`, `SET`, `REMOVE`, `CLEAR`, `MOVE`, and `VIS` operations use a flat,
self-delimiting encoding in which every address is an instance/slot pair, so one
compiler-assigned slot index no longer names one anchor per instance. Slot values
are scalars, which is what lets a frame be validated by its header alone rather
than by walking arbitrary structure.
