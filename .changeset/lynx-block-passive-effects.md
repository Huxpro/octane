---
'@octanejs/lynx': patch
'octane': patch
---

Run page-level passive effects on the Lynx Block background core.

The shared universal hook scope now accepts separate layout and passive commit
schedulers. The Block root publishes passive cleanup/create work only after the
host acknowledges the matching mutation batch, schedules it through the root's
Lynx-safe microtask service, and flushes pending work before another render or
unmount. Dependency changes, effect phase changes, callback failures, and
unmount cleanup retain the universal root's ordering rules. Insertion effects
remain an explicit refusal because the Block core still has no pre-mutation
phase.
