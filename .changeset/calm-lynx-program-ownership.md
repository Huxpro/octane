---
'@octanejs/lynx': patch
---

Retain a proof-covered first-tree program run as one native ownership journal
instead of copying its nodes, events, and host records into per-host maps during
adoption. Hosts promote into the ordinary journals only when a later update
touches them, while clear, fault cleanup, and disposal retain complete ownership.
