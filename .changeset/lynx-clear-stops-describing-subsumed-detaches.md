---
'@octanejs/lynx': patch
---

Stop describing a cleared run's listener detaches, and stop snapshotting events
onto a destroy nothing reads.

Expanding a `destroy-run` against ordinary records synthesized one `event`
command per listener before the `destroy` that retires the same host — two of
every ten commands a benchmark table row's teardown produced. `destroy` already
ends the listener lifetime through `removeAllNativeEvents`, with the teardown
flag read live in the apply phase. On a container with no native list the
expansion now leaves the detaches to it: 100,000 synthesized commands become
80,000 at 10,000 rows. A container that owns a native list still describes them,
so the unbind-then-remove order it relies on is unchanged.

The `destroy` apply operation also no longer carries a copy of the record's
events. No apply branch read it, so it was one map allocation per destroyed
host.
