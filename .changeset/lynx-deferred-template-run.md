---
'@octanejs/lynx': patch
'octane': patch
---

A `mount-template-run` can now declare a native list's rows without building
them.

A native `<list>` decides for itself which of its rows are on screen and asks
for a cell only when it is about to display one, so materializing every instance
at mount bought nothing and cost one host record per host per row — a 10,000-row
list held ~70,000 records to show the ~12 that are visible. The command had no
way to say otherwise, and `mount-template-run` was refused under a `<list>`
outright.

`mount-template-run` gains an optional `deferred: true`. A deferred run says
exactly what an eager one says — the same program, the same values, the same
identity range — and asks the host to keep the declaration instead of the
instances; the host builds a row from `(program, values)` at the moment the list
asks for it. Absence of the field is the eager meaning, so a run written before
this existed means what it always meant.

The Lynx driver accepts a deferred run only directly under a native `<list>`,
only with a `<list-item>` root, and only without `before` or bound
`main-thread:` props. A template program may now declare a `<list-item>` as its
root for that purpose; `<list>` stays refused everywhere, a nested `<list-item>`
is refused, and an eager mount of a `<list-item>` root is refused. Everything
downstream — physical trees, recycling, the attachment journal — still sees
ordinary host records.

Nothing emits `deferred` yet, so no existing peer's behavior changes.
