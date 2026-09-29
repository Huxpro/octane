---
'@octanejs/lynx': patch
---

Keep `flushTransport()` open for a render requested by an accepted passive effect when the host microtask queue (`lynx.queueMicrotask`) is serviced after promise jobs. The flush now yields one host turn while accepted passive work is still queued before deciding the transport is idle.
