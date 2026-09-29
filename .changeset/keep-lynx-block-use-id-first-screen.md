---
'@octanejs/lynx': patch
'octane': patch
---

Keep `useId` values stable across the Lynx first-screen handoff. Block page, row,
and branch scopes now draw ids from one root counter in the same namespace the
main-thread first screen paints, so adoption keeps each painted `id` instead of
rewriting it. `createUniversalHookScope` accepts an `allocateId` service for
cores that own a root id namespace.
