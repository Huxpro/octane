---
'octane': patch
---

Extract the universal hook owner's minimal storage/lifetime contract and bind
owner scheduling through a host-neutral injected callback. Universal renderer
profiling and root scheduling remain core-owned, while state and reducer
updates retain their batched, disposed-owner-safe behavior.
