---
'octane': patch
---

The `target: 'lynx'` main-thread compile can now carry a compiled create function
instead of a description an interpreter walks at run time.

`compileUniversal` takes a new `mainThreadProgramBackend` option: the renderer's
own build-time backend, which lowers a plan to a host template program and
compiles that program to main-thread source. With no backend supplied every plan
lowers exactly as it did before the option existed, so the background chunk and
the universal bundle are byte-identical across the switch by construction rather
than by a caller remembering which layer to pass it to. The compile refuses to
emit outside the main-thread lynx layer for the same reason.

An eligible plan the backend can describe emits `{ kind: 'program', slots, values,
events, ranges, bind }` in place of `{ kind: 'template', slots, create }`. `bind`
takes the host once per program and returns a create function whose values and
listeners are positional; `values` and `events` say which plan slot each position
reads, and `ranges` where the keyed holes were. The keyed slot map is unchanged —
it is the contract, not the description. A plan the backend cannot describe as a
program keeps the interpreted encoding silently; a plan it *can* describe but
would paint differently is a build error naming the prop or node it refused.

The backend hands over source text rather than an AST, because a string is the
only interface between two packages that does not make one depend on the other's
parser. The compiler parses it once into the AST it already prints, clears the
positions it arrives with, and re-attributes the subtree to the template it was
derived from, so the published source map keeps pointing at authored code.

Nothing consumes a compiled program yet: teaching the renderer to freeze, adopt
and update one is a later slice, and no build supplies a backend today.
