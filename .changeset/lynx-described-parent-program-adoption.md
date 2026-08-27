---
'@octanejs/lynx': patch
---

A described parent's compiled rows now adopt instead of forcing a repaint.

The main-thread program mount linked its program's root into the logical tree
in only two of the three cases a described host resolves: a page root landed in
`rootChildren`, a keyed range member of another program deliberately landed
nowhere, and a program whose parent *was* described landed nowhere either — so
that parent's record listed only the children that happened to be described.
The background's description of the same parent then disagreed, adoption
answered `repair`, and a first screen the program had already painted correctly
was repainted over the command path on every launch.

The shape is not exotic. The main-thread backend constructs `view`, `text` and
raw text and nothing else, and writes `class`, `className` and `id` and nothing
else, so a shell holding a `scroll-view`, an `image`, or a `style` prop emits no
create function — silently, as an ordinary compile — while its `@for` rows go on
compiling to programs. Every such app paid a full first-screen repaint.

The mount now resolves all three cases in the same order the described-host walk
uses, at the point in the walk where the rows sit, so a program's root lands
among its parent's children at the hole's position and in member order rather
than after the siblings declared behind the hole.
