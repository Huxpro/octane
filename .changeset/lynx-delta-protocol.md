---
'@octanejs/lynx': patch
---

Add the typed, versioned Lynx slot-delta protocol for the specialized renderer.
`RUN`, `SET`, `REMOVE`, `MOVE`, and `BRANCH` operations use a flat,
self-delimiting encoding with instance/range framing and header-only validation;
dynamic slot values remain opaque to the transport layer.
