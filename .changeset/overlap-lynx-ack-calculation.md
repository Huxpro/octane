---
'octane': patch
'@octanejs/lynx': patch
---

Overlap compiler-proved pure scalar Lynx Block calculations with an older host
frame awaiting acknowledgement. Keep physical frames serialized, coalesce newer
continuous input into one bounded logical draft, and preserve hook, event, ref,
effect, rejection, fault, and teardown publication boundaries.

Expose ACK-pipeline queue, merge, preparation, and round-trip counters to profile
builds and the Lynx benchmark evidence.
