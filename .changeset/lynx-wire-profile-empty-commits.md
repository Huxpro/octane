---
'@octanejs/lynx': patch
---

Wire profiler: count the commits that carried no host command.

`__OCTANE_LYNX_PROF` gains `emptyCommits` on both threads, beside the existing
`commits` and `commands`. A commit count on its own cannot tell one large batch
split into chunks from a render pass that ran and found nothing to say — both
read as "more commits than changes", and they are opposite facts about a core.

The counter is inside the existing `__OCTANE_LYNX_PROFILE__` build flag, so
production bundles fold it away with the rest of the profiler and the hot
dispatch and receive paths are unchanged.
