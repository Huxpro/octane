---
'@octanejs/lynx': patch
---

Emit compiler-addressed Lynx Block RUN, SET, MOVE, REMOVE, CLEAR, and visibility
deltas directly into the resident main-thread program store. Scalar updates no
longer rebuild complete host props or recover slots through a delta shadow,
while render-attempt rollback, keyed survivor identity, event routing, and
compiler-derived root/range teardown remain transactional.
