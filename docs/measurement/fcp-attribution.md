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

**Bucket 4 is a named exclusive remainder, so on its own it cannot nominate an
owner.** It is arithmetic — wall minus the terms that were observed — not an
observation. Naming a mechanism inside it is exactly what the #230 protocol
forbids, however large it is. A bucket-4 verdict needs an instrument that
observes inside it, and there are two; **Splitting bucket 4** below is the
procedure for using them and for the one comparison against the reference that
they license.

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

## Splitting bucket 4

Two instruments observe inside the remainder. They answer different questions,
sample different windows, and their milliseconds must never be added together
or divided into each other.

### The phase split — is bucket 4 the framework or the platform?

`papi-run.mjs` already produces it, for any run whose cell list includes
`octane-profile`:

```bash
node stages/papi-run.mjs \
  --cells octane,octane-profile,react-first-screen \
  --scales 1000,10000 --reps 5 --label <lowercase-dashed>
```

The framework publishes which first-screen phase is running — render, publish,
capture, announce — and the boundary probe attributes each host call to the
phase that issued it, so a phase's own off-boundary time is its wall span minus
the host time observed inside it. What no phase claims is the **residue**:
web-core's own script between the host calls, plus the browser's style, layout,
paint and observer frame. `render` crosses the host boundary not at all, so its
whole span is framework script by construction rather than by subtraction.

Three things about reading it:

- **The marker folds out of a shipping bundle**, so the split is measured on
  `octane-profile` and the shipping cell is beside it as the control on what
  the probe build costs. The two builds are never divided into a ratio.
- **The residue is an upper bound on the platform's share, not a measurement of
  it.** Framework script before the first host call is `start_delay`, a separate
  term, so bundle evaluation is already excluded; what can still land in the
  residue is framework script inside the window but outside the four phases.
  That direction flatters Octane, which makes the framework total a floor.
- **`react-first-screen` has no phase split and cannot be given one.** The
  vendored bundle is used as built. What it does have is its whole bucket 4,
  and that total is the only thing Octane's split may be argued against —
  never against a part of it, because it has no parts.

The comparison the last point licenses is the one that carries the verdict:
Octane's **framework** row against the reference's **whole** bucket 4. That
subtracts nothing on the reference side, so it holds however React's own bucket
4 divides internally.

#### Two shares, two denominators, and only one of them is section 3's

The split invites two different shares, and they are not interchangeable:

| share | denominator | what it answers |
|---|---|---|
| framework ÷ Octane's own bucket 4 | `octane-profile` `off_boundary` | how much of Octane's remainder is Octane's script |
| framework excess ÷ the FCP gap | `median(octane fcp total) − median(reference fcp total)` | how much of the gap against the reference that excess accounts for |

Only the second uses **Section 3's denominator**, and only the second is a claim
about the gap. The first is a composition statement about one cell and says
nothing about the reference; quoting it as a share of the gap overstates the
finding by about 22 points.

Neither share is additive with the buckets in section 3, and for the same
reason: `frameworkMs` and `residueMs` are each the median of their own
per-sample series, so they do not sum to the `off_boundary` median beside them
(516.3 + 92.7 against 594.5, at 10,000 rows in window B). Take them from the
harness's `firstScreen.frameworkMs` and `.residueMs` fields. Summing the four
phase medians by hand gives a different and wrong answer — 486.2 rather than
516.3 in that window — because the median of a sum is not the sum of medians.

#### What this split's resolution actually is

Section 3's ±0.04 is the resolution of a **single-window FCP ratio**. It does
not transfer to this split, which has its own, measured the same way — from the
two same-code windows `c247-o2-bucket4-*` and `c247-o2-bucket4-b-*`, at 10,000
rows:

| quantity | window A | window B | spread |
|---|---:|---:|---:|
| `frameworkMs` | 505.0 | 516.3 | 11.3 ms (2.2%) |
| `residueMs` | 94.9 | 92.7 | 2.2 ms (2.3%) |
| framework excess over the reference's whole bucket 4 | 281.7 | 278.4 | 3.3 ms (1.2%) |
| framework ÷ own bucket 4 | 0.842 | 0.869 | **0.027** |
| framework excess ÷ FCP gap | 0.616 | 0.619 | **0.003** |

**The derived shares are steadier than the terms they are built from**, and that
is not luck. Within a single window `frameworkMs` spreads 11.2% and 11.5% across
its five repetitions, and `residueMs` up to 26.5%; a window that runs hot runs
hot for both cells, so the drift is largely common-mode and divides out of a
ratio taken inside that window. It does not divide out of a millisecond.

So the ordering of what to quote is the reverse of what the raw numbers suggest:
the gap share replicates to 0.003 and is the number a verdict should rest on;
the millisecond excess replicates to 1.2% and is good for sizing; the individual
phase milliseconds are the least stable thing here and should be read as an
ordering, not as quantities. A claim on any of them still needs the second
window — one window cannot show you its own drift.

### The function split — which functions own the framework's share

`mts-profile.mjs` CPU-profiles the hidden main-thread realm and folds the
frames by the string literals a minifier cannot rename:

```bash
node stages/mts-profile.mjs --rows 10000 --reps 5 --cells octane \
  --label <lowercase-dashed>
```

Its milliseconds are not the boundary instrument's — a sampling profiler
perturbs the page and this run carries no uninstrumented control — so what
transfers from it is the **shape**: which function owns the script. Take the
wall clocks from `papi-run.mjs` and use this only to say what is inside them.

**Read `unnamed by the probe table` before reading any bucket.** A probe is
matched against minified text in a 160-character window from the frame's start,
so a probe stops matching when an edit moves it out of that window — the
function keeps running and its bucket reads 0.0 ms. That is not hypothetical:
`applier walk` read 0.0 while `visit` and `pushChildren` sat in `unmatched` at
93.5 and 18.0 ms, the two largest unnamed frames in the run, because a
dense-span fast path was added ahead of the destructuring the probe was taken
from. **The largest frames the probe table did not name** is the section that
makes this visible, and a large frame there is a probe to repair before the
record is read as an attribution.

### The trap: two windows, one temptation

The phase split and the function split come from different windows and
different instruments. Their totals do not match and are not meant to: at
10,000 rows the phase split put Octane's first-screen script at 505.0 ms of
off-boundary while the profiler saw 392.4 ms of main-thread script self time in
its own window. Neither number corrects the other. What is legitimate is
checking that they **order the phases the same way** and put roughly the same
share in each; what is not is subtracting one from the other, or reporting a
function's profiled milliseconds as a share of the boundary instrument's wall.
