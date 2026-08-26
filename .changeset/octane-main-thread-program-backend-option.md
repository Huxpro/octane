---
'octane': patch
'@octanejs/rspack-plugin': patch
---

A build can now hand the compiler a renderer's own build-time main-thread
program backend, so a bundler's main-thread chunk carries compiled create
functions instead of the template descriptions an interpreter walks per node.

`createOctaneCompiler({ mainThreadProgramBackend })` takes the backend as the
live module rather than a request string: the code it holds encodes one
renderer's applier semantics down to which prop shadows which, and a copy of it
inside `octane` would be a copy that can disagree — not a build error, but a
first screen painted by one implementation and updated by another. It is
forwarded to every full compile and the universal compiler decides for itself
which plans a backend may describe.

`@octanejs/rspack-plugin` accepts the same value as a top-level option and as a
`layerSpecializations.<layer>.mainThreadProgramBackend`, so a two-thread graph
gives it to the thread whose chunk paints the first screen and a single-thread
graph configures it once. A layer that receives one anyway compiles exactly as
it did before: the compiler emits a program only for a main-thread universal
runtime, which is what keeps a bundle's other chunks byte-identical by
construction rather than by every caller passing the option to exactly one
place.

A backend must expose `signature`, a string naming the emitted output's shape.
It travels into the plugin's persistent-cache salt so a rebuild cannot reuse
create functions a different emitter wrote; presence alone would not, because
two backends that both exist are not the same backend.
