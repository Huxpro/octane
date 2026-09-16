---
'octane': patch
'@octanejs/lynx': patch
---

Give host-neutral `useOptimistic` Action-owned overlays: optimistic updates
publish urgently, rebase over the latest passthrough, and revert in the same
accepted transition while a rejected native frame retains the overlay for
retry. Transition-external updates still render once before reverting.

Compiler-proved Lynx Block applications now admit `useOptimistic`. Block event
bridges preserve discrete update priority across hook-scope boundaries, and
both main-thread renderers expose a render-only passthrough preview without
running optimistic reducers.
