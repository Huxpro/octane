# Lynx native-list allocation benchmark

This Node-only suite drives the real Octane Lynx host implementation through a
minimal fake Element PAPI. It scrolls a 12-cell visible window across 1,000
logical, recyclable `<list-item>` rows and records deterministic source-level
diagnostics for physical cell allocation, reuse, and teardown.

The `eager-list-model` target allocates one cell per logical item. The committed
ratio guard requires Octane's physical-cell count to remain at most 2% of that
reference. Semantic text checksums and native identity checks ensure a lower
count cannot come from skipping rows or replacing reuse with stale content.
Teardown must detach every reachable cell and make late native callbacks inert.

## What one recycle costs

The counters above say how many cells are reused. A second measurement says what
a reuse *costs*: every fake Element PAPI entry point is counted, and one sample
is recorded around each scroll step's `enqueueComponent` + `componentAtIndex`
pair. It is reported against a **slot-write floor** — writing only the values
that differ between the outgoing row and the incoming one, touching only the
nodes that own them.

Two row shapes run, because one cannot separate "the write path tracks the
changed values" from "it tracks the row's size":

| row | nodes | varying values | writes per recycle | floor | ratio |
| --- | --- | --- | --- | --- | --- |
| `list-item > text > #text` | 3 | 2 | 6 | 2 | 3.00x |
| card row with a nested badge | 9 | 3 | 15 | 3 | 5.00x |

`setAttribute` is **2 and 3** — the floor exactly, at both widths. The residual is
`setRefSelector`: two calls per *element* node per recycle, clearing the
`nodes-ref` selector when the cell is enqueued and reinstalling it for the
incoming logical host. So per-recycle PAPI traffic is bounded by the row's
element count, not by its prop count, and the prop write path has no slack in it.

These are deterministic call counts, not timings, so they carry across hosts and
sessions. They do not measure the CPU the host spends deciding what to write.

```bash
node benchmarks/bench.mjs --quick --ratios lynx-list
```

This is deliberately not a timing, memory, layout, or device-lifecycle claim.
Those behaviors still require the Android and iOS probes described in the Lynx
renderer plan.
