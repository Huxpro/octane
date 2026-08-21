---
'@octanejs/lynx': patch
---

The Lynx background core is now selected at build time. `@octanejs/rspeedy-plugin`
gains a `core` option — `'universal'` (default, today's behaviour) or `'block'`
for the issue-#103 Block core — and `@octanejs/lynx` reads it as a compile-time
constant, so a bundle carries exactly one core and the other's closure
tree-shakes out. `withLynxBlockProgram(component, program)` attaches a Block-core
program to a component: a universal build ignores the attachment and renders the
component, and a block build runs the program, so one application entry can be
driven by either core. A block build handed a component with no attached program
refuses it, naming the missing component layer, rather than rendering partially.
Measured on the bundle-size fixture: the background program drops 35,779 B gzip
(75,517 → 39,738) with the main-thread program byte-identical
(`benchmarks/lynx-bundle-size/core-switch.mjs`).
