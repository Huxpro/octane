---
'octane': patch
'@octanejs/lynx': patch
'@octanejs/rspeedy-plugin': patch
---

Select fixed-shape native-list rows for production Lynx Block applications.

Retain logical keyed items in the compact store, publish native list deltas
transactionally, materialize and recycle cells on Lynx demand, rebind scalar and
event identity, reject stale callbacks, and propagate asynchronous callback
faults. Explicitly defer native-list first-screen paint to the first compact
frame while keeping structurally nested rows on the Universal fallback.
