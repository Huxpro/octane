---
'octane': patch
'@octanejs/lynx': patch
---

A native `<list>` declares its rows instead of building them.

A universal host driver can now say where a host of a given type may sit inside
a template program, and whether a program rooted at such a host must be mounted
as a run that declares its instances rather than building them. Where a plan
containing a `list` or `list-item` was refused outright, the refusal is now the
renderer's own answer, so a renderer with no constrained host is unaffected and
pays nothing.

The Lynx client driver uses it: a `<list>` stays out of every program, a
`<list-item>` is a program root and never a program's interior, and a keyed
range of cells under a `<list>` is sent as one deferred `mount-template-run`.
The rows exist to the core exactly as before — same state, effects, events, and
updates — but main builds one only when the list is about to show it. A row the
renderer will not declare, such as one binding a main-thread worklet, falls back
to the hosts it got before, as does a page whose main thread never granted the
deferred-run capability.
