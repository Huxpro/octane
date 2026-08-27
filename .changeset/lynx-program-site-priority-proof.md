---
'@octanejs/lynx': patch
---

A compiled program's event priority is proven once, not re-checked per row.

`freezePlanNode` already restated a program plan's structural guarantees once
per plan — a site names a node the program makes, `(node, type)` names at most
one site, a range sits at one of the program's own positions. It said nothing
about the third thing a site declares. So the mount had to: every token a
program installed went through the checking encoder, which re-asked five
questions per event site per row, one of which nothing else answered.

The priority now has the same two-sided treatment the rest of a site has. The
main-thread emitter refuses a site whose priority is not `discrete`,
`continuous` or `default`, and `freezePlanNode` restates that refusal once per
plan for the plans that do not come from the emitter. The mount then reads a
site's priority from the plan rather than from the announcement — the plan is
the half that carries a proof — and builds the token instead of re-validating
it.

Four of the token's five primitives are now proven before the mount reaches
them, each named in place: the container root at container creation, the host id
by the applier's own input contract, the generation by being a literal, and the
priority by the plan freeze. The fifth, the announced listener id, arrives on
the envelope and is still checked where it is used.

Backend signature bumped to `lynx-main-thread-program/5`.
