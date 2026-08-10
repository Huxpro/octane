---
'@octanejs/lynx': patch
---

Pace background commits to the main thread's frame rate: at most one non-empty commit dispatches per main-thread frame, held commits fold interim renders into the next commit's state, empty batches cross unpaced, and a `commitPacing: 'immediate'` root option restores unpaced dispatch. Hosts without a frame source keep today's immediate behavior, and the first commit after idle always dispatches immediately.
