---
'@octanejs/lynx': patch
---

Paint a compiled main-thread program from the direct first-screen applier.

`applyLynxFirstScreenDirect` now binds the host once per program, calls the
compiled create, appends any keyed range's members into the node the program
made, and puts the assembled subtree in the page with a single append. A first
screen carrying a program is painted rather than refused.

The emitted create changed to make that possible, so the backend signature moves
to `lynx-main-thread-program/2`:

- it returns its root instead of appending it, and takes no `parent` parameter.
  The caller performs the one append, which is what lets a range's members go
  into a node the program made before any of it is live;
- it installs an event site only when the caller supplies that site's listener,
  so an authored handler that was not passed installs nothing — the same answer
  the command path gives by simply not listing that host.

A program's subtree is deliberately never described, so nothing writes a record
for a node it made. `disposeLynxHostContainer` reads the physical ownership and
native event journals and tears one down completely; `captureLynxFirstTree`
refuses by name rather than journalling a tree missing everything the program
painted. The applier also refuses, by name and before painting anything, a host
with no intrinsic element factories, a hidden program, and a program inside a
native list row.
