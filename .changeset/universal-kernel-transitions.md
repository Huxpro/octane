---
'octane': patch
---

Extract universal transition batch ownership, pending state, promotion, and
cross-root settlement into the host-neutral kernel. Renderer roots now inject
their scheduling, discard, microtask, and update-queue services while preserving
nested, asynchronous, canceled, and unmounted transition behavior.
