---
'@octanejs/lynx': patch
'@octanejs/rspack-plugin': patch
'@octanejs/rspeedy-plugin': patch
---

Load and verify the Lynx main-thread program backend by default for dual-thread
Rspeedy applications while retaining Rspack worker compilation. Treat plans the
compiled emitter cannot reproduce as conservative command-path fallbacks, and
cross-check worker-derived positional addresses in the main compilation.
