---
'octane': patch
'@octanejs/vite-plugin': patch
'@octanejs/rspack-plugin': patch
---

Compiler-inferred dependency arrays can now read across module boundaries, behind
`crossModuleHookFacts: true` on the Vite or Rspack plugin.

When a hook is imported, the compiler resolves and analyses the module that
defines it, and omits the result from an inferred array if that module's own
source proves the identity fixed — a returned ref, a state updater, an
empty-dependency `useMemo`/`useCallback`, a module-scope constant, or a tuple
slot holding one of those. Transparent re-exports are followed. Previously the
compiler could only reason about hooks defined in the same file, so a stable
value from a binding package occupied a dependency slot forever.

This is a proof rather than a convention. A hook whose result cannot be proven
stable stays a dependency, and an unresolvable, unreadable, unparseable, or
shadowed callee behaves exactly as it did before — the failure mode of the whole
mechanism is the previous behaviour, never a missed dependency.

Off by default on measurement, not principle: on the Octane website build it
costs about 14% and proves two facts out of 315 candidate imports, so it earns
its keep only where hooks from binding packages are used heavily. The setting
applies to dev and build alike, so the two never infer different arrays, and an
edit to a defining module re-infers the arrays derived from it.
