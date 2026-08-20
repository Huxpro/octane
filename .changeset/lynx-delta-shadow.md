---
'@octanejs/lynx': patch
---

Add a profiling-only dual-path bridge from accepted Lynx command commits to the
typed slot-delta protocol. RUN, SET, MOVE, and REMOVE streams are differentially
checked against an applier that addresses instances by wire handle, without
changing the production wire, and the entire shadow encoder is compiled out when
profiling is disabled.
