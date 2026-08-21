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
| `list-item > text > #text` | 3 | 2 | 2 | 2 | 1.00x |
| card row with a nested badge | 9 | 3 | 3 | 3 | 1.00x |

Every write is a `setAttribute`, and there are exactly as many as there are
values that changed. The wide row has three times the element nodes and pays
nothing extra, which is what says per-recycle traffic tracks the changed values
rather than the row's width.

Nodes touched does not reach its floor — 3 against 2, and 4 against 3 — because
`getUniqueId` and `flush` name the `<list>` node itself once per recycle. That is
list bookkeeping, not per-row work, and it does not grow with the row.

### Who asks about a cell

A recycle also emits attachment deltas: one per node of the outgoing cell and
one per node of the incoming one. The main thread filters that batch by looking
up each host's identity and comparing generations, so the container here wires
`onAttachments` and replays that predicate.

| row | attachment deltas per recycle | writes the predicate performed |
| --- | --- | --- |
| `list-item > text > #text` | 6 | 0 |
| card row with a nested badge | 18 | 0 |

The zero is a contract, not an accident, and this is where it is enforced. A
`nodes-ref` selector exists only where a public instance was requested, and the
predicate has no idea whether one was — so asking must not install one. Pointing
it back at `getPublicInstance`, which does install, would put one write per
element node per recycle into this column and breach the ratio guards above.

The container here is built with `announcesPublicInstances`, which is what the
main thread does for a peer that negotiated `lazyPublicInstances` — a peer that
announces every host it will query. A peer below that capability keeps the eager
install, because for it an uninstalled selector is a ref that addresses nothing;
this suite does not measure that fallback.

These rows carry no ref, no lifecycle, and no main-thread callback, so nothing
announces them and the floor is reachable. A row that does carry one is
announced, and each announced node pays the same clear-and-reinstall pair it
always did. The saving is therefore per node that nobody queries, not per row.

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
