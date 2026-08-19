---
'octane': patch
---

First kernel-extraction slice for the Lynx-specialized core (issue #58 L2):
`octane/src/universal-kernel.ts` now owns the host-neutral hook cell types,
hook update-queue value types, and pure cell helpers, with the owner record
and transition batch entering only as type parameters. `universal-core.ts`
binds the generics and re-exports the public types, so runtime behavior and
the public surface are unchanged; the remaining extraction seams are
inventoried in `docs/lynx-specialized-target-l0.md` §5.
