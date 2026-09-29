---
'@octanejs/rspeedy-plugin': patch
---

Fail an explicit `experimentalElementTemplate` build when the application cannot select the whole-root Element Template owner, instead of silently building the general application. The error lists each declining reason code with its entry and module, including development and watch builds, which the selection does not support. An incomplete template lowering now names each module whose plans did not lower.
