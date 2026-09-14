---
'@octanejs/lynx': patch
'@octanejs/rspeedy-plugin': patch
---

Add a fail-closed compiler lowering from shared Lynx program IR to the public
Element Template Definition schema. Preserve the existing compiled-program
value/event/range positions so a whole-root template backend can reuse the
compact background protocol without mixing template handles with ordinary
Element refs.
