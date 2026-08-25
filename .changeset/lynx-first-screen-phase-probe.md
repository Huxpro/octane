---
'@octanejs/lynx': patch
---

Publish which first-screen phase is running on the profile record, so a
host-boundary instrument can attribute each host call to the phase that issued
it.

`profiling.ts` gains `firstScreenPhase` plus a wall span per phase — render,
publish, capture, announce — and `renderFirstScreenNow` marks them between the
statements it already runs, closing the marker in its `finally` so a faulted or
declined first screen leaves none open. Every branch is gated on
`__OCTANE_LYNX_PROFILE__` and folds away in a shipping bundle, exactly as the
commit-pipeline counters beside it already do.

The first screen goes through none of those commit-pipeline counters — it is
`renderFirstScreenNow`, not a commit — so until now nothing described it at all.
