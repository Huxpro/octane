---
'@octanejs/lynx': patch
---

Keep production compiled-program applications interactive when the background
frame batches sibling programs whose nested children were painted between them
on the main thread. First-screen ownership now matches the proved program and
native parent while preserving host and listener identity checks.
