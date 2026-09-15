---
'octane': patch
'@octanejs/lynx': patch
'@octanejs/rspack-plugin': patch
'@octanejs/rspeedy-plugin': patch
---

Add a fail-closed compiler lowering from shared Lynx program IR to the public
Element Template Definition schema. Preserve the existing compiled-program
value/event/range positions so a whole-root template backend can reuse the
compact background protocol without mixing template handles with ordinary
Element refs. Add the explicit Rspeedy application option, target-3.2 encoder
metadata, opaque template PAPI owner, first-screen adoption/defer path,
transactional update and cleanup store, and Android-qualified limits for queued
painting work, live template instances, and resident native nodes. Oversized
eager trees now fail with `Octane Lynx OL512` before exhausting JNI reference
tables; large collections should use the virtualized native-list backend.
