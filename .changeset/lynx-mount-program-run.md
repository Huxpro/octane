---
'octane': patch
'@octanejs/lynx': patch
'@octanejs/rspack-plugin': patch
'@octanejs/rspeedy-plugin': patch
---

Mount a main-thread-resident compiled program by name.

A background run command can now carry a program's address — its module id and
its index in that module's plan order — instead of carrying the program's
description. The addressed mount re-enters the same applier a described one
takes, with the program resolved from the realm's own registry rather than read
off the wire, so the painted tree, the assigned ids, the installed listeners and
adoption are identical by construction.

What the naming buys is the memoization. `prepareTemplateProgram` and
`assertTemplateProgram` both key on program object identity, so a description
that crosses the realm boundary misses both on every mount, while a resident
program is walked and validated once for the chunk's life.

Addressing is a whole-build decision, because an address is positional: both
thread layers must agree about which plans are programs and in what order. Both
compiles reach that answer by running the same derivation, and each emits a
structural digest of the derived wire, which the build compares and fails on
disagreement. An isolated single-thread graph has no second compile to check
against and refuses the option outright, keeping described mounts.
