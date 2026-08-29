---
'@octanejs/lynx': patch
---

Acknowledge every compact-eligible template run compactly, not just the first.

Taking the compact acknowledgement path swaps the client driver's record store
to its dense representation, and the incremental-compact candidate test asks for
a `Map`. So preparation stopped recording a host count from the second run
onwards, and the main thread read the missing count as "not compact" and replied
with one handle per host instead. On the benchmark's repeated
`Create 10,000 rows` that was 70,000 handle deltas — 17.4 MB on the wire, on
every sample after the first.

The count is a property of the batch, so the main thread now recomputes it
rather than letting the container the driver happens to be holding its records
in decide a wire encoding. The existing check below that read still re-validates
any recomputed count against the prepared handle deltas.
