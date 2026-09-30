---
'octane': patch
---

Lynx Block applications now keep a keyed `@for` row authored as `const Row = memo(LocalComponent)` on the Block core. The compiler previously reported that wrapper as an external component, so the whole application fell back to the Universal core. It now resolves the wrapper to the local component it wraps, but only while every link is an immutable module-root binding and `memo` comes from `'octane'`.
