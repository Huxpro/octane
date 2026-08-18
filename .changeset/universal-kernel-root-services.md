---
'octane': patch
---

Inject the narrow root capabilities consumed by universal hooks. ID formatting
and bridge context reads no longer require the full universal root type, and
speculative memo caches use an opaque per-root token while preserving abort,
replay, and cross-root isolation.
