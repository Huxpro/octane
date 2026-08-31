# Issue #195 / #193: what a heterogeneous feed costs a commit

A native `<list>`'s rows are declared by a `mount-template-run`, and a run
covers a **contiguous span of one row shape**. A keyed `@for` whose body has two
branches therefore declares one run per row for a feed that alternates between
them — the ordinary shape of a real feed — so runs scale with rows rather than
with lists.

Every reader that resolves a declared host used to scan the run list linearly,
on the reading recorded in the source that "a run is one command per native
list". Two readers do that per row: the staging pass looks up every id a
declared range covers, and the per-commit walk that tells a list about its
logical rows reads every row again. Both were therefore **O(rows × runs)**.

This record is the before/after for making those lookups a binary search over
runs kept ordered by `firstId`.

## Recipe

The probe is checked in at `packages/lynx/tests/_probes/list-run-lookup.probe.ts`
and is not run by CI. Its own header carries the instructions; in short:

```sh
cp packages/lynx/tests/_probes/list-run-lookup.probe.ts \
   packages/lynx/tests/_probes/list-run-lookup.probe.test.ts
npx vitest run --project lynx \
   packages/lynx/tests/_probes/list-run-lookup.probe.test.ts \
   --silent=false --reporter=verbose
rm packages/lynx/tests/_probes/list-run-lookup.probe.test.ts
```

Both arms render `packages/lynx/tests/_fixtures/native-list-shape-classes.lynx.tsrx`
at the same row count and send the same rows through the same code. They differ
only in how many runs those rows are declared as: the homogeneous arm declares
one, the alternating arm one per row. Arms alternate AB/BA across five samples.
Two windows are reported — `mount`, the commit that declares the rows, and
`update`, the commit that changes every row's text.

## Environment

Node v22.22.2, Intel Xeon @ 2.10 GHz, 4 vCPU, Linux; jsdom +
`@lynx-js/testing-environment`, vitest `--project lynx`. Base
`4081baf732f1b7d865f32a60e3ede9b46399a141` (`new-lynx`). Both arms of both
tables were measured back to back on an idle machine (1-minute load average
below 0.6 at the start of each).

This is a shared cloud VM, so the absolute milliseconds are worth nothing on
their own. The reading is the **ratio between two arms measured in the same
process at the same size**, which cancels the machine, and the way that ratio
moves as the row count doubles. An earlier pass of this same probe was discarded
because two `pnpm typecheck` runs were competing for the four cores; that data
is not in this record.

## Before — the linear scan

| rows | window | homogeneous | alternating | ratio |
| ---: | --- | ---: | ---: | ---: |
| 1,000 | mount | 20.9 ms | 56.7 ms | 2.71× |
| 2,000 | mount | 36.8 ms | 141.3 ms | 3.84× |
| 4,000 | mount | 79.9 ms | 595.6 ms | 7.45× |
| 1,000 | update | 24.4 ms | 36.8 ms | 1.50× |
| 2,000 | update | 44.4 ms | 86.0 ms | 1.94× |
| 4,000 | update | 91.8 ms | 307.3 ms | 3.35× |

Samples (ms), in the order the probe printed them:

- 1,000 mount: homogeneous `65.8, 24.0, 20.9, 18.2, 20.5` — alternating `102.3, 78.4, 56.7, 54.9, 54.3`
- 2,000 mount: homogeneous `36.9, 35.5, 31.0, 38.9, 36.8` — alternating `144.6, 146.6, 141.3, 137.5, 139.8`
- 4,000 mount: homogeneous `80.4, 68.0, 70.8, 80.4, 79.9` — alternating `514.2, 658.2, 891.2, 595.6, 525.5`
- 1,000 update: homogeneous `49.3, 24.4, 28.1, 23.9, 23.6` — alternating `50.6, 48.2, 34.1, 36.8, 35.0`
- 2,000 update: homogeneous `45.4, 42.3, 42.4, 44.4, 45.7` — alternating `89.4, 86.0, 85.2, 87.3, 84.1`
- 4,000 update: homogeneous `92.4, 91.8, 89.0, 90.3, 94.3` — alternating `319.8, 307.3, 543.4, 275.6, 275.1`

Both ratios roughly double as the row count doubles. That is the signature of a
term proportional to rows × runs sitting on top of the linear work: with one run
per row, runs *are* rows.

## After — the ordered lookup

| rows | window | homogeneous | alternating | ratio |
| ---: | --- | ---: | ---: | ---: |
| 1,000 | mount | 20.5 ms | 40.6 ms | 1.98× |
| 2,000 | mount | 40.0 ms | 75.9 ms | 1.90× |
| 4,000 | mount | 77.9 ms | 156.5 ms | 2.01× |
| 1,000 | update | 28.2 ms | 30.0 ms | 1.06× |
| 2,000 | update | 44.6 ms | 51.1 ms | 1.15× |
| 4,000 | update | 97.1 ms | 115.1 ms | 1.19× |

Samples (ms):

- 1,000 mount: homogeneous `66.6, 20.5, 19.1, 22.6, 20.4` — alternating `65.8, 54.5, 38.4, 40.6, 40.0`
- 2,000 mount: homogeneous `40.0, 45.5, 40.2, 34.7, 38.9` — alternating `77.1, 79.1, 70.6, 67.3, 75.9`
- 4,000 mount: homogeneous `77.9, 91.1, 73.1, 74.4, 85.9` — alternating `152.5, 161.2, 154.4, 156.5, 159.0`
- 1,000 update: homogeneous `46.0, 36.4, 28.2, 28.1, 25.7` — alternating `40.5, 40.9, 30.0, 25.2, 27.0`
- 2,000 update: homogeneous `46.3, 44.6, 41.5, 45.6, 43.3` — alternating `51.1, 66.4, 46.9, 51.1, 51.5`
- 4,000 update: homogeneous `95.1, 97.2, 93.8, 97.1, 100.4` — alternating `110.8, 177.5, 109.8, 115.1, 116.5`

Both ratios stop climbing with row count, and the homogeneous arm is unchanged
within its own spread in both windows — the ordered lookup costs the one-run
case nothing.

## What this does and does not say

- **Says**: the superlinear term is gone. What remains between the arms is flat
  in row count — about 2× at mount, under 1.2× on an update. The mechanism is
  verified by reading rather than inferred from these numbers: the two lookups
  went from a `for…of` over every run to a binary search, and their callers are
  named in the source.
- **Does not say** anything about a device. This is jsdom on a shared VM, so it
  prices the JavaScript, not the platform. Nothing here is a device claim and
  none of it is comparable across windows or across records.
- **Does not close** the run-count question. The mount's residual ~2× is real
  linear work: one run per row is one command, one value table and one
  declaration per row, and no lookup change removes that. Closing it is #193's
  Layer 1 — a row shape as a compiled program the list materializes cells from.
  What this record establishes is that the remaining cost there is linear rather
  than quadratic, so Layer 1 is an optimization and no longer a cliff.
