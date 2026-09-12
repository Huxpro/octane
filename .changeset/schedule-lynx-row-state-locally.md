---
'octane': patch
'@octanejs/lynx': patch
---

Schedule state and reducer updates from keyed Lynx Block rows against their
retained row scope instead of re-running the owning page and every sibling.
Updates now perform one keyed lookup regardless of unrelated row count while
preserving committed props and hook lifecycles across moves, rejected frames,
retries, removals, and reinsertion. When a page does render, compiler-certified
stable component ranges now skip iterable enumeration, key evaluation, row-prop
allocation, and retained-map rebuilding while their source and dependency tuple
remain identical; unproved expressions retain complete conservative discovery.
Compiler program values may now carry pure hook dependency groups. Covered
page-state updates project only their queued hook cells, run each affected group
once, and write the resulting bindings through one retained-block visit without
executing the component setup; incomplete or structural proofs fall back to the
full component transaction.
Eligible ordinary compiled components now emit these dependency groups
automatically for state, reducer, derived, conditional, nested scalar, event,
and structural outputs. Dirty scalar updates encode and write only affected
bindings and listener sites; unrelated program slots and rows no longer add
wire-value cloning, validation, or lookup work.
