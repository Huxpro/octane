---
'@octanejs/lynx': patch
---

Build first-screen host records without spreading and deleting. Every host the
first screen rendered copied its incoming props into a new object and then
deleted `key`, `ref`, `children`, and each event-named prop off that copy —
which drops the object out of V8's fast properties for the rest of its life,
and these objects live as long as the first screen does, read by both the
direct applier and adoption capture. The props bag is now built by copying only
the keys it keeps, in one pass that also collects the events, and a host that
binds nothing shares one empty event map instead of allocating its own. Raw
`#text` records, three of every seven hosts in the benchmark fixture, skip the
generic host path entirely: their props are a string `value` and nothing else,
which is the shape the host driver already asserts.
