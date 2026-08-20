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

## What a mounted list retains

A separate script, because it is a byte measurement and this suite's guards are
deterministic counts:

```bash
node --expose-gc benchmarks/lynx-list/retention.mjs 5
```

`createPhysicalTree` materializes a row from `state.records` and throws
`native list requested missing host` if the record is absent, so **every logical
row's records must exist and be retained** even though only the visible window is
ever physical. The script measures that against what a deferred run would hold
for the same page — one compiled program plus one value row per item — with both
arms handed the same row strings, so each delta is the structure built on top of
the application's own data.

Every sample runs in its own process. Measuring both arms in one process makes
the second arm's baseline depend on what the first left behind, which showed up
as a spread wide enough to move the ratio by half; one build per process removes
that history and the readings become exactly reproducible.

The logical-host counts are exact and carry anywhere. The byte figures are
`heapUsed` deltas, so they are host-bound and only the ratio inside one sitting
is portable. The deferred arm is modelled generously — a plain JS array per row,
heavier than a packed slot table — so the gap it reports is a lower bound.

This is deliberately not a timing, memory, layout, or device-lifecycle claim.
Those behaviors still require the Android and iOS probes described in the Lynx
renderer plan.
