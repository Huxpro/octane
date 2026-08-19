---
'@octanejs/lynx': patch
---

Walk the direct first screen with an explicit stack instead of recursion.
`applyLynxFirstScreenDirect` and the `firstScreenTreeHasList` predicate that
runs just ahead of it each consumed a call frame per tree level, which made the
first screen the only stack-bound stage in a pipeline whose staged path walks a
flat command array. Deep trees the renderer can produce now paint instead of
failing with `RangeError`.
