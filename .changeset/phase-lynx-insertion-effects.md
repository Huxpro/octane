---
'octane': patch
'@octanejs/lynx': patch
---

Run `useInsertionEffect` on the Lynx Block path after native acknowledgement,
before every accepted layout effect and passive microtask. Rejected attempts
publish no effects, keyed component scopes share a global phase boundary, and
insertion effects remain connected across Activity hide/reveal while hidden
dependency changes and final teardown still run their cleanup lifecycle.

Paired production graphs now admit the hook through the versioned Block support
matrix. The compact main-thread first screen recognizes the hook without running
its background callback, then the accepted background frame owns its lifecycle.
