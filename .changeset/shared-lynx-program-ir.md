---
'octane': patch
'@octanejs/lynx': patch
'@octanejs/rspack-plugin': patch
'@octanejs/rspeedy-plugin': patch
---

Derive eligible Lynx host programs through one versioned compiler IR shared by
the background and main-thread compiles. Emit an independent Block background
artifact that carries compiler wire and site maps instead of a Universal plan,
consume it directly in the Block core, and reject unsupported graphs or ABI
versions before mounting. Automatically rebuild proved production Block graphs
onto that renderer through a module-scoped Rspack compiler specialization, so
ordinary applications retain conservative fallback on the first pass but ship
the independent BTS artifact. Keep the original main-thread-named derivation
hook as a compatibility fallback and propagate the new backend identity through
Rspack workers and default Rspeedy application builds.
