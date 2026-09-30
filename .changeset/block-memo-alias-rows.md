---
'octane': patch
'@octanejs/lynx': patch
---

Lynx Block applications now keep a keyed `@for` row authored as `const Row = memo(LocalComponent)` on the Block core, with the same fast paths as a plain row.

- The compiler used to report that wrapper as an external component, so the whole application fell back to the Universal core. It now resolves the wrapper to the local component it wraps, but only while every link is an immutable module-root binding and `memo` comes from `'octane'`.
- On the Block core, a default-compare `memo` around a component the compiler proved hook-free now renders that component directly. The core already skips such a row on shallow-equal props, which is exactly when the memo would bail out. Its selection, same-key and structural sparse paths stay available instead of being turned off by the wrapper's hook scope.
- A custom comparator, or a hooked body, keeps the wrapper and its semantics.
