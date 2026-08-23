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
ever physical. That is the eager arm. The declared arm sends the same page as one
deferred `mount-template-run` and lets the driver derive a row when the platform
asks for it. Both arms are the real host container over the same fake Element
PAPI, handed the same row strings, so each delta is the structure the arm builds
on top of the application's own data.

### Deferral is deferral, not release

The script measures each arm in five states, because "a declaration is cheap" and
"a declaration stays cheap" are different claims:

| state | what it is | narrow records, eager → declared |
| --- | --- | --- |
| `mounted` | the commit landed, nothing shown | 3,001 → **1** |
| `idle` | the first screen and nothing more | 3,001 → **37** |
| `half` | half the rows' text rewritten, then the first screen | 3,001 → **525** |
| `written` | every row's text rewritten, then the first screen | 3,001 → **1,025** |
| `scrolled` | the first screen, then scrolled end to end | 3,001 → **3,001** |

The wide row is the same shape at nine hosts per row: 9,001 → 1, 109, 597, 1,097,
9,001.

Two facts come out of that column, and neither is visible from the mount alone.
A **write** promotes exactly the host it wrote, not the row that contains it, so
rewriting every row of a 1,000-row list costs 1,000 records and not 3,000. A
**read** promotes the row and keeps it promoted after the cell is enqueued, so a
list the user has scrolled through converges on the eager count exactly. Both are
pinned as tests in `packages/lynx/tests/list-recycling.test.ts`; the counts here
are those contracts at scale, and the bytes are what they cost.

### Reading the byte column

Every sample runs in its own process. Measuring several arms in one process makes
each one's baseline depend on what the last left behind, which showed up as a
spread wide enough to move the ratio by half; one build per process removes that
history and the readings become exactly reproducible.

The record counts are exact and carry anywhere. The byte figures are `heapUsed`
deltas, so they are host-bound and only a ratio inside one sitting is portable.

The eager arm is also the instrument's control: it holds the same record count in
every state above, so whatever its byte column does across those states is what
the instrument cannot resolve. The script prints that span, and names the state
carrying it when one state carries most of it — a heap-sizing step in one row
should not widen every other row's error bar.

Both arms carry receipts, because an arm that silently did nothing reads as a
finding: the declared arm checks that a write commit promoted exactly as many
hosts as it wrote, and both arms check that the rewritten row actually painted
its new text. The eager arm needs the paint check specifically because its record
count is supposed not to move under writes, so a count is no receipt there.

`#120`'s stand-in — one frozen program plus one value row per item, with no
container, list, cell, or record — is measured beside the `mounted` state so the
model that sized this work can be checked rather than retired quietly.

This is deliberately not a timing, memory, layout, or device-lifecycle claim.
Those behaviors still require the Android and iOS probes described in the Lynx
renderer plan.
