# Attributing an FCP@N gap against a reference

#247 Order 1 asks where Octane's first screen spends its extra time against
ReactLynx at 10,000 rows, split into named segments. This file records how that
split is produced, which controls license it, and the two traps that cost time
the first time it was run.

The instrument is `benchmarks/lynx-table/stages/papi-run.mjs` and its observation
contract is documented in that directory's README under **Observation contract
(host boundary)**. This file is the procedure built on top of it, not a second
instrument.

## The four buckets, and why there are only three numbers

The window runs from the main-thread slice start to all N rows in the composed
tree. The wall obeys the harness identity:

```
wall = start_delay + Σ host-group self time + off_boundary
```

Four things are worth attributing separately, and they map onto that identity as
**three** measurable terms:

| bucket | term | what it holds |
|---|---|---|
| 1 bundle evaluation | `start_delay` | fetch, parse and evaluate the bundle |
| 2 framework boot | `start_delay` | framework init up to the first host call |
| 3 first-screen render | Σ host groups | every call the framework makes to build the tree |
| 4 render → FCP predicate | `off_boundary` | framework script, browser style/layout/paint, observer-frame delay |

**Buckets 1 and 2 are irreducibly fused, and this is a property of a fair
boundary rather than a gap in the instrument.** `sliceStartEpoch` is the moment
the hidden main-thread iframe is given its Blob script URL — *before* the browser
loads, parses or evaluates anything. So bundle evaluation and framework boot both
sit inside `start_delay`, and the only event in that window observable without
knowing either framework's internals is the **first host call**. Any line drawn
between them would have to be drawn from framework-specific knowledge, which
would stop the two cells from being measured the same way. Report the pair fused.

**Bucket 4 is a named exclusive remainder, so it cannot nominate an owner.** It
is arithmetic — wall minus the terms that were observed — not an observation.
Naming a mechanism inside it is exactly what the #230 protocol forbids, however
large it is. A bucket-4 verdict needs an instrument that observes inside it
first.

## Recipe

### 1. Run both arms in one window

```bash
cd benchmarks/lynx-table
node stages/papi-run.mjs \
  --cells octane,react,react-first-screen \
  --scales 1000,10000 --reps 5 --label <lowercase-dashed> --allow-busy-host
node stages/papi-report.mjs --label <lowercase-dashed>
```

Five repetitions is the floor the harness enforces. `react-first-screen` is the
only reference that measures this window at all; `react` is included because its
create window is the workload control below.

`--label` stems every output basename, so a run lands beside the checked-in
records rather than over them.

### 2. Check the workload control before reading any delta

```
create ops/row:  octane 20.0001   react 21.0001   react-first-screen 21.0001
```

The two react cells are **different builds** — a different upstream commit and
`@lynx-js/react` 0.124.0 against 0.122.1. What says they still measure the same
benchmark is that their create windows issue the same host calls per row. If that
row ever diverges, the two builds are no longer the same workload and the
divergence, not the delta, is the finding.

### 3. Compute the buckets

`start_delay` and `off_boundary` are read from
`cells.<id>.fcp.timed.stages`; bucket 3 is the sum of the six `papi_*` medians
beside them.

**The share denominator is not the sum of the bucket deltas.** It is

```
denominator = median(octane fcp total) − median(reference fcp total)
```

which is what the harness's own delta sections divide by. Dividing by the sum of
bucket deltas instead makes the shares sum to exactly 100% and quietly discards
the median non-additivity — the identity is exact per sample, but each bucket is
a median of its own sample, so the three do not add to the whole. Shares
computed the right way do **not** sum to 100%, and that residue is real.

## The resolution bound: ±0.04 on the FCP@10k ratio

**Two windows of identical code, same cells, same host, gave octane ÷ react
ratios of 1.411× and 1.452× at 10,000 rows.** The checked-in records are
`stages/results/c247-o1-*` and `stages/results/c247-o1-direct-*`; the second
exists only to establish this.

That spread of 0.041 is the resolution of a single-window FCP ratio here. It is
larger than most changes move the number: a third window with a real
element-count reduction in it (#242 Cause A, −20,026 host calls) landed at
1.441×, inside the spread, and its wall-clock effect could not be claimed.

Two consequences, and the second is the one that gets skipped:

- **Any first-screen wall-clock claim smaller than ±0.04 needs more windows.**
  A host-call count is exact and a millisecond ratio is not; prefer the count as
  the oracle wherever the change has one.
- **Repeat the control arm, not just the candidate.** Running the candidate twice
  measures the candidate's variance. Only re-running *unchanged* code through the
  whole pipeline exposes what the pipeline itself contributes, and that is the
  number a candidate has to beat.

**Which buckets scale is itself a stable result**, and it is what separates a
constant cost from a per-row one. Across a 10× row increase, Octane's own
`start_delay` is flat (×0.99 and ×1.02 across the two windows) while its bucket 3
grows ×8.6–9.0 and its bucket 4 ×7.0–7.5; the reference scales the same way
(×8.7–9.5 and ×7.9–8.9). So buckets 1+2 are a fixed startup cost that 10,000 rows
does not enlarge — consistent with the bundles themselves being effectively
row-independent — and the whole row-scaled gap lives in buckets 3 and 4.

Bucket 3's delta inherits the resolution problem and is worse: it read +128.1 ms and +63.2 ms
across those same two same-code windows, because the timed probe's overhead on
the reference cell varied 6.8% while its control wall varied 1.2%. Report bucket
3 as row-scaled and second-largest — not as a number.

## Which numbers survive a window change

From the same two windows, at 10,000 rows:

| quantity | stability |
|---|---|
| host-call counts | **exact** — zero spread across all five repetitions |
| ops/row control | **exact** |
| bucket 1+2 delta | ±1.4 ms, and **does not scale with rows** — it shrinks ×0.68 from 1k to 10k in *both* windows |
| bucket 4 delta | ±7 ms on ~295 ms — the largest bucket and the steadiest of the two row-scaled ones |
| bucket 3 delta | **±65 ms** — direction only |
| the ratio itself | **±0.04** |

Counts are the reliable currency at this boundary. Milliseconds are for sizing,
and only against a control measured in the same window.
