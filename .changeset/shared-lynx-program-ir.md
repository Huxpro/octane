---
'octane': patch
'@octanejs/lynx': patch
'@octanejs/rspack-plugin': patch
'@octanejs/rspeedy-plugin': patch
---

Derive eligible Lynx host programs through one versioned compiler IR shared by
the background and main-thread compiles. Reject unsupported IR versions before
emission or addressing, keep the original main-thread-named derivation hook as
a compatibility fallback, and propagate the new backend identity through
Rspack workers and default Rspeedy application builds.
