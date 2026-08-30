---
'@octanejs/rspeedy-plugin': patch
---

Forward `parallel` to `@octanejs/rspack-plugin`, so a Lynx build can pin whether
Octane modules compile in Rspack worker threads.

The option already existed downstream but had no way through this plugin, which
left worker compilation unpinnable from `lynx.config.ts`. It matters beyond
build time: a worker receives its loader options by structured clone, so a build
carrying `mainThreadProgramBackend` compiles on the main thread regardless, and
two builds that differ only in that option would also differ in module order at
the minifier — enough to move the short names in their output and to make two
otherwise byte-identical bundles compare unequal.
