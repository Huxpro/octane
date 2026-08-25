---
'@octanejs/lynx': patch
---

Two per-node reductions in the synchronous first screen's publish walk.

A leaf host now attaches to its parent inline instead of through a deferred
walk frame. The frame existed to hold the bottom-up attach order the staged
path produces, but a node with no children queues nothing behind it, so the
frame popped with the stack in exactly the state it was already in. Most of a
large first screen is leaves — every `#text` host is one — so this is the
difference between one frame per host and one per interior host. A `<list>`
keeps its deferred frame either way, because its row publication is queued
behind the attach.

Installing a background event no longer builds a token identity object only to
validate it reflectively. The host holds the identity's five primitives
separately and hands them to a new checked encoder, which runs the same
primitive checks in the same order with the same messages and skips only the
structural ones — a prototype read, a key enumeration, two array scans and five
descriptor reads that asked whether a literal written two lines earlier was a
plain object with these five keys. Callers holding an identity object they did
not build still use the validating object encoder.

No behavior changes: the host-call sequence, the physical tree, the adoption
snapshot, and every refusal are identical.
