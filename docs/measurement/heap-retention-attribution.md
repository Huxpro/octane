# Attributing what `heapMtsAfterClear` measures

[`heap-after-clear.md`](./heap-after-clear.md) documents the oracle: one
post-collection `Runtime.getHeapUsage` reading on a fresh page. That is a
scalar, and a scalar can say a gap exists while never saying who owns it —
#230's rule that a named remainder nominates nobody applies to a heap number
exactly as it applies to `off_boundary`. E2 closed on clear *cost* and
explicitly did not close on retention for that reason.

`benchmarks/lynx-table/stages/heap-retention.mjs` is the instrument that turns
the gap into named buckets. This file is its recipe.

## What it does

Per repetition, on a **fresh** page — the same requirement `heap-after-clear.md`
imposes, for the same reason — it captures four points:

| capture | when |
|---|---|
| `fresh` | the shell has painted, zero rows |
| `afterCreate` | after `Create N rows`, settled |
| `afterClear` | after `Clear`, settled |
| `afterClear2` | after a **second** create-and-clear on the same page |

Each capture is `HeapProfiler.collectGarbage`, then `Runtime.getHeapUsage` (the
scalar, so the probe can be checked against a published figure rather than
trusted), then `HeapProfiler.takeHeapSnapshot`. The snapshot is folded to
`bucket -> {bytes, count}` and dropped inside the capture: three raw 10,000-row
snapshots held for a later diff would cost more memory than the thing being
measured.

Three tables come out of that:

- **`afterClear` − `fresh`** — what survived the teardown.
- **`afterCreate` − `fresh`** — what the rows cost while live. A bucket in both
  is holding on after teardown; a bucket only in the second was released. That
  contrast is the attribution, and neither table alone makes it.
- **`afterClear2` − `afterClear`** — leak or high-water mark. This is the one
  that makes the first table readable. A single cycle cannot distinguish an
  array still holding rows from an array that grew a backing store for them and
  kept it. A bucket that reappears here at roughly its cycle-one size grows once
  per cycle and is unbounded; a bucket absent here took its capacity once.

The second cycle is deliberately warm, and is only ever compared against cycle
one on the same page — never against `fresh`, which is the one capture that page
is entitled to.

## Reading the tables without being misled

- **Self size, not retained size.** Retained size needs a dominator tree over
  the whole edge graph and double-counts across shared owners. Self size is
  exact and additive, and answers "which constructors hold the surviving bytes".
  It does **not** answer "who points at them" — a bucket named here is an
  owner-of-bytes, not a root cause.
- **The share column divides by the gap, not by the rows.** Dividing by the
  summed rows would force the shares to total 100% and hide exactly the
  unattributed remainder the probe exists to expose.
- **A share over 100% is not an error.** The denominator is
  `Runtime.getHeapUsage`, which counts V8's managed heap only, while a
  snapshot's `self_size` for `native:system / JSArrayBufferData` counts the
  **external** backing store. Such a row is real retention the oracle cannot
  see. Do not normalise it away.
- **Nameless types fold by type.** A `string` node is named by its contents and
  a `number` node by nothing useful; bucketing those by name yields tens of
  thousands of one-element buckets and buries the constructors that matter. They
  keep their bytes, folded into one bucket per type.
- **The tail row names nobody.** `(other growth)` past the top-N is a remainder
  of the same shape as `off_boundary`, and under the same rule.
- **Shrinking buckets are kept.** A bucket that shrinks across create-then-clear
  is the evidence that the teardown it belongs to actually ran. Dropping the
  negative rows would leave a table that can only ever confirm retention.

## Recipe

The app bundle is the shared `benchmarks/lynx-table` one, so the ladder build is
the same as every other stage.

```bash
cd benchmarks/lynx-table
# builds app/dist (omit --skip-build on a clean tree)
NODE_OPTIONS=--max-old-space-size=8192 node stages/heap-retention.mjs \
  --rows 10000 --reps 3 --top 25 --label <label> --core universal
```

`--core block` reads `app/dist-block` instead. `--reps` runs that many fresh
pages; attribution is the **median sample by the `afterClear` scalar**, not a
mean of aggregates — averaging bucket tables across repetitions would invent a
heap no run ever had, and picking one run keeps every row consistent with the
scalar printed beside it. Results land in
`stages/results/<label>-<rows>.{json,md}`.

`--allow-busy-host` overrides the load guard; use it only when the run is
attributing composition rather than timing, since the create/clear milliseconds
in the scalar table are then not comparable.

## Comparing two records

Every generated report names the commit it measured, and says so in its second
paragraph rather than only in the JSON. That line is not bookkeeping. This
probe's largest managed-heap row is one `WeakRef` per painted element, so its
readings move whenever the element count does — and the element count is a
property of the compiler, not of the page.

The first campaign is the worked example. `c230-retention-10000` was taken at
`432c64859`, before #250 folded a compile-time-known text child onto its `text`
host; `c252-postcausea-10000` was taken after. A row went from seven painted
elements to six, and the two records differ by half the retained total. Neither
number is wrong and neither supersedes the other — they measure different code.

`c230-retention-10000` predates the stamp and so carries none; its base is
recorded here instead. Every record written since names its own.

Two consequences for anyone quoting a figure from one of these files:

- **A retention figure is only comparable to one taken at a named commit.** Two
  numbers from this probe with no commit between them are not a delta.
- **`dirty: true` disqualifies a record for comparison.** The stamp then names
  code that is not what ran, and the report says so in bold.

## Units

The trap `heap-after-clear.md` names applies here too, one layer further on.
The campaign harness records **bytes**; #241 quotes **MB** (`/1e6`); this probe
prints **MiB** (`/2**20`). MB and MiB are 4.9% apart, which is inside the range
where a retention claim can be argued either way. Every number in the generated
report is MiB, and every number in the JSON is bytes.

## Naming what holds a bucket — `--attribute`

The fold names which constructors hold the bytes. It does not name what points
at them, and a bucket is not a diagnosis: `array` is V8's own type for an
unnamed backing store, so `array:` describes the shape of the thing and never
its owner.

`--attribute <bucket>` walks the edge graph the fold declines to, for the
`afterClear` snapshot of the median sample:

```bash
node stages/heap-retention.mjs --rows 10000 --reps 3 --attribute 'array:'
```

The report then carries, for each of the bucket's largest nodes:

- **`held by`** — every edge in the snapshot that lands on that node. This is
  exact. A node with three retainers has three, and which of them matters is
  the reader's call, not the probe's.
- **a shortest chain from a GC root** — one path, not the only one, and
  shortest is not the same as responsible. It nominates something to go and
  read in the source; it does not prove the nomination is why the bytes
  survived.

It is off by default and should stay off by default. It costs a pass over the
edge table and a breadth-first walk of the whole graph, on a snapshot this
probe otherwise drops the moment it is folded. Pay it once a bucket has earned
it by size and by growing per cycle; never otherwise.

## What the probe still cannot tell you

A retainer path names an owner in the heap, not a line of source. Going from
`object:Table` to the call that grew it is still reading, and the path is what
makes that reading short rather than speculative.

Nor does it rank owners: self size says how big a node is, and the chain says
who reaches it, but neither says how much of the total would be freed if that
owner let go. That is a dominator-tree question, and this probe does not build
one.
