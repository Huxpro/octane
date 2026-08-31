# Retained-heap attribution — universal core, 10,000 rows

3 repetitions, a fresh page each. Attribution below is the
median sample by `afterClear`; the scalars from every repetition are listed so
the median is visible rather than asserted.

Measured at `a4d22e2953d4103d319586f50f4d331fd6fcb797`, on
Node v22.22.2 and 141.0.7390.37, 1-minute load 0.04 per CPU. The
commit is here because the numbers below are only comparable to another record
taken at a *named* commit: this probe's readings move with the element count,
and the element count moves with the code.

## Scalars (`Runtime.getHeapUsage`, post-collection, MiB)

These are the same reading the campaign harness records as `heapMts` and
`heapMtsAfterClear`. They are here so this probe can be checked against a
published figure rather than trusted.

| rep | fresh | afterCreate | afterClear | afterClear2 | create ms | clear ms |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 3.81 | 44.86 | 4.98 | 5.54 | 2750.1 | 485.8 |
| 1 | 3.84 | 44.87 | 4.98 | 5.54 | 2827.5 | 535.2 |
| 2 | 3.81 | 44.87 | 4.98 | 5.54 | 2644.3 | 500.2 |

Median retained over fresh: **1.17 MiB**
(1,230,048 bytes).
Median live over fresh: **41.06 MiB**.

## What survives the clear — `afterClear` minus `fresh`

Self size per constructor. The share column divides by the **retained total
above**, not by the summed rows, so the rows do not add to 100% and the
unattributed part stays visible.

A share above 100% is not an error and must not be normalised away. The
denominator is `Runtime.getHeapUsage`, which counts V8's managed heap only,
while a snapshot's `self_size` for a `native:system / JSArrayBufferData` row
counts the **external** backing store. Such a row is real retention that the
scalar cannot see, so it is reported at its own size against the scalar it
exceeds rather than folded into it.

| bucket | bytes | MiB | share of retained | nodes |
|---|---:|---:|---:|---:|
| `native:system / JSArrayBufferData` | 14,745,600 | 14.06 | 1198.8% | 0 |
| `object:WeakRef` | 960,000 | 0.92 | 78% | 60,000 |
| `array:` | 519,032 | 0.49 | 42.2% | -25 |
| `hidden` | 37,835 | 0.04 | 3.1% | 252 |
| `native:NodeList` | 4,648 | 0 | 0.4% | 88 |
| `native:PerformanceEventTiming` | 4,608 | 0 | 0.4% | 18 |
| `native:TaskAttributionTiming` | 1,536 | 0 | 0.1% | 12 |
| `object shape:system / Map` | 1,480 | 0 | 0.1% | 37 |
| `native:PerformanceLongTaskTiming` | 1,344 | 0 | 0.1% | 12 |
| `array:(object elements)` | 756 | 0 | 0.1% | 36 |
| `native:PerformanceLongAnimationFrameTiming` | 720 | 0 | 0.1% | 5 |
| `native:PerformanceScriptTiming` | 448 | 0 | 0% | 4 |
| `object shape:system / PrototypeInfo` | 324 | 0 | 0% | 9 |
| `native:system / ExternalStringData` | 297 | 0 | 0% | 37 |
| `object shape:system / WeakArrayList` | 244 | 0 | 0% | 5 |
| `object:Object` | 232 | 0 | 0% | 9 |
| `array:(object properties)` | 176 | 0 | 0% | 1 |
| `object shape:system / TransitionArray` | 156 | 0 | 0% | 5 |
| `native:HTMLCollection` | 104 | 0 | 0% | 1 |
| `native:Range` | 88 | 0 | 0% | 1 |
| `object:Array` | 80 | 0 | 0% | 5 |
| `object shape:(enum cache)` | 64 | 0 | 0% | 4 |
| `object shape:system / Cell` | 64 | 0 | 0% | 8 |
| `object:HTMLCollection` | 60 | 0 | 0% | 3 |
| `object:MouseEvent` | 60 | 0 | 0% | 3 |

Beyond the top 25: **0 MiB** across
16 further buckets. That row is a remainder and names no
owner — the same shape as `off_boundary`, and subject to the same rule.

## What the rows cost while live — `afterCreate` minus `fresh`

Kept beside the retention table because a bucket that appears in both is holding
on after teardown, while one that appears only here was released. That contrast
is the attribution; neither table alone makes it.

| bucket | bytes | MiB | share of retained | nodes |
|---|---:|---:|---:|---:|
| `native:system / JSArrayBufferData` | 14,745,600 | 14.06 | 34.3% | 1 |
| `array:` | 9,997,240 | 9.53 | 23.2% | 110,013 |
| `object:Object` | 9,160,440 | 8.74 | 21.3% | 370,018 |
| `native:<slot name="inline-truncation">` | 5,760,000 | 5.49 | 13.4% | 30,000 |
| `native:<slot part="slot">` | 5,760,000 | 5.49 | 13.4% | 30,000 |
| `native:ShadowRoot` | 5,760,000 | 5.49 | 13.4% | 30,000 |
| `native:<div id="inner-box" part="inner-box">` | 3,600,000 | 3.43 | 8.4% | 30,000 |
| `native:DOMTokenList` | 3,360,000 | 3.2 | 7.8% | 60,000 |
| `native:Text` | 2,880,000 | 2.75 | 6.7% | 30,000 |
| `closure:` | 2,799,972 | 2.67 | 6.5% | 99,999 |
| `object:r1` | 2,640,000 | 2.52 | 6.1% | 30,000 |
| `native:NamedNodeMap` | 2,485,152 | 2.37 | 5.8% | 60,000 |
| `object:system / Context` | 2,359,980 | 2.25 | 5.5% | 99,999 |
| `string` | 2,113,664 | 2.02 | 4.9% | 39,954 |
| `object:Map` | 1,760,032 | 1.68 | 4.1% | 110,002 |
| `native:CSSStyleDeclaration` | 1,722,576 | 1.64 | 4% | 30,000 |
| `native:<x-text class="col-id">` | 1,520,000 | 1.45 | 3.5% | 10,000 |
| `native:<x-text class="col-label">` | 1,520,000 | 1.45 | 3.5% | 10,000 |
| `native:<x-text class="col-remove" text="x">` | 1,520,000 | 1.45 | 3.5% | 10,000 |
| `native:<x-view class="row">` | 1,520,000 | 1.45 | 3.5% | 10,000 |
| `array:(object elements)` | 1,360,524 | 1.3 | 3.2% | 60,016 |
| `object:c` | 1,280,000 | 1.22 | 3% | 40,000 |
| `object:rQ` | 1,200,000 | 1.14 | 2.8% | 50,000 |
| `object:Array` | 960,320 | 0.92 | 2.2% | 60,020 |
| `object:WeakRef` | 960,000 | 0.92 | 2.2% | 60,000 |

## Leak or high-water mark — `afterClear2` minus `afterClear`

A second create-and-clear on the same page. The first cycle cannot separate a
bucket that is still holding data from one that grew a backing store and kept
it; this one can. A bucket here at roughly its cycle-one size grows once per
cycle and is unbounded. A bucket absent here took its capacity once and is
reusing it, and the cycle-one row is a high-water mark rather than a leak.

Second cycle: create 3111.5 ms, clear 670.1 ms; scalar moved
**0.55 MiB**
(579,908 bytes).

| bucket | bytes | MiB | share of retained | nodes |
|---|---:|---:|---:|---:|
| `native:system / JSArrayBufferData` | 15,204,352 | 14.5 | 2621.9% | 0 |
| `array:` | 524,432 | 0.5 | 90.4% | 3 |
| `code` | 45,692 | 0.04 | 7.9% | 260 |
| `hidden` | 14,557 | 0.01 | 2.5% | 20 |
| `native:PerformanceEventTiming` | 4,352 | 0 | 0.8% | 17 |
| `string` | 2,256 | 0 | 0.4% | 77 |
| `native:TaskAttributionTiming` | 1,536 | 0 | 0.3% | 12 |
| `native:NodeList` | 1,376 | 0 | 0.2% | 0 |
| `native:PerformanceLongTaskTiming` | 1,344 | 0 | 0.2% | 12 |
| `object shape:system / DescriptorArray` | 764 | 0 | 0.1% | 10 |
| `native:PerformanceLongAnimationFrameTiming` | 720 | 0 | 0.1% | 5 |
| `object shape:system / Map` | 680 | 0 | 0.1% | 17 |
| `native:PerformanceScriptTiming` | 560 | 0 | 0.1% | 5 |
| `native:<slot name="inline-truncation">` | 192 | 0 | 0% | 0 |
| `native:<slot part="slot">` | 192 | 0 | 0% | 0 |
| `object shape:system / PrototypeInfo` | 144 | 0 | 0% | 4 |
| `object:Object` | 132 | 0 | 0% | 5 |
| `object shape:(enum cache)` | 128 | 0 | 0% | 8 |
| `object shape:system / TransitionArray` | 96 | 0 | 0% | 2 |
| `object shape:system / EnumCache` | 48 | 0 | 0% | 4 |
| `object:Array` | 48 | 0 | 0% | 3 |
| `array:(object elements)` | 44 | 0 | 0% | 3 |
| `object shape:system / WeakArrayList` | 28 | 0 | 0% | 1 |
| `number` | 24 | 0 | 0% | 2 |
| `object shape:system / Cell` | 16 | 0 | 0% | 2 |

Beyond the top 25: **0 MiB** across
0 further buckets, and it names no owner either.
