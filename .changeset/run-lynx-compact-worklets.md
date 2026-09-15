---
'@octanejs/lynx': patch
'@octanejs/rspeedy-plugin': patch
---

Run compiler-authored main-thread worklets, refs, and captured background
functions through the compact Lynx application product. Preserve their native
ownership across updates, visibility changes, list cell recycling, failures,
and teardown, while ordinary compact applications avoid initializing worklet
state.
