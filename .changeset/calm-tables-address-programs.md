---
'octane': patch
'@octanejs/lynx': patch
---

Let compiler-proved scalar text rows use resident Lynx program runs after a
program-painted first screen.

The universal compiler now consumes the same string proof as ordinary text
lowering, so producer and resident layouts agree without weakening the fallback
for renderable ranges or shadowed `String` bindings. The Lynx consumer accepts,
validates, freezes, acknowledges, and assigns ownership for addressed program
runs in incremental commits, including compact lazy-public-instance batches.
