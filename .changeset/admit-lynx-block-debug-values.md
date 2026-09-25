---
'@octanejs/lynx': patch
'@octanejs/rspeedy-plugin': patch
---

Admit compiler-proved `useDebugValue` calls in Lynx Block applications. Both
main-thread renderers now preserve the hook's render-scope contract while
leaving native first-screen output unchanged and deferring formatter work to
debugging tools.
