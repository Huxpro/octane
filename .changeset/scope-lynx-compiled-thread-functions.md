---
"@octanejs/lynx": patch
"@octanejs/rspeedy-plugin": patch
---

Remove compiled-program thread-function support from production Lynx bundles only when paired compiler proofs show that every entry is thread-function free.
