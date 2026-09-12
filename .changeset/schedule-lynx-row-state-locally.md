---
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
