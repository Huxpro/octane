# Retained-heap attribution — universal core, 10,000 rows

1 repetitions, a fresh page each. Attribution below is the median
sample by `afterClear`; the scalars from every repetition are listed so the
median is visible rather than asserted.

## Scalars (`Runtime.getHeapUsage`, post-collection, MiB)

These are the same reading the campaign harness records as `heapMts` and
`heapMtsAfterClear`. They are here so this probe can be checked against a
published figure rather than trusted.

| rep | fresh | afterCreate | afterClear | afterClear2 | create ms | clear ms |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 3.79 | 48.69 | 6.17 | 6.74 | 1685.8 | 230.4 |

Median retained over fresh: **2.38 MiB**
(2,500,804 bytes).
Median live over fresh: **44.9 MiB**.

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
| `native:system / JSArrayBufferData` | 16,056,320 | 15.31 | 642% | 0 |
| `object:WeakRef` | 1,120,000 | 1.07 | 44.8% | 70,000 |
| `array:` | 1,047,864 | 1 | 41.9% | 11 |
| `code` | 303,292 | 0.29 | 12.1% | 1,114 |
| `hidden` | 41,188 | 0.04 | 1.6% | 422 |
| `native:NodeList` | 5,320 | 0.01 | 0.2% | 100 |
| `native:PerformanceEventTiming` | 5,120 | 0 | 0.2% | 20 |
| `string` | 4,764 | 0 | 0.2% | 110 |
| `object shape:system / Map` | 1,440 | 0 | 0.1% | 36 |
| `native:TaskAttributionTiming` | 1,280 | 0 | 0.1% | 10 |
| `object shape:system / DescriptorArray` | 1,236 | 0 | 0% | 12 |
| `native:PerformanceLongTaskTiming` | 1,120 | 0 | 0% | 10 |
| `native:system / ExternalStringData` | 1,057 | 0 | 0% | 65 |
| `native:PerformanceLongAnimationFrameTiming` | 576 | 0 | 0% | 4 |
| `native:PerformanceScriptTiming` | 448 | 0 | 0% | 4 |
| `object:Object` | 276 | 0 | 0% | 11 |
| `array:(object properties)` | 256 | 0 | 0% | 2 |
| `object shape:system / PrototypeInfo` | 216 | 0 | 0% | 6 |
| `object shape:system / WeakArrayList` | 160 | 0 | 0% | 3 |
| `object shape:system / TransitionArray` | 128 | 0 | 0% | 4 |
| `native:HTMLCollection` | 104 | 0 | 0% | 1 |
| `native:Range` | 88 | 0 | 0% | 1 |
| `object:Array` | 80 | 0 | 0% | 5 |
| `object shape:(enum cache)` | 64 | 0 | 0% | 4 |
| `number` | 60 | 0 | 0% | 5 |

Beyond the top 25: **0 MiB** across
20 further buckets. That row is a remainder and names no
owner — the same shape as `off_boundary`, and subject to the same rule.

## What the rows cost while live — `afterCreate` minus `fresh`

Kept beside the retention table because a bucket that appears in both is holding
on after teardown, while one that appears only here was released. That contrast
is the attribution; neither table alone makes it.

| bucket | bytes | MiB | share of retained | nodes |
|---|---:|---:|---:|---:|
| `native:system / JSArrayBufferData` | 16,056,320 | 15.31 | 34.1% | 1 |
| `array:` | 11,936,624 | 11.38 | 25.4% | 120,013 |
| `object:Object` | 9,920,436 | 9.46 | 21.1% | 400,018 |
| `native:<slot name="inline-truncation">` | 5,760,000 | 5.49 | 12.2% | 30,000 |
| `native:<slot part="slot">` | 5,760,000 | 5.49 | 12.2% | 30,000 |
| `native:ShadowRoot` | 5,760,000 | 5.49 | 12.2% | 30,000 |
| `native:<div id="inner-box" part="inner-box">` | 3,600,000 | 3.43 | 7.6% | 30,000 |
| `native:DOMTokenList` | 3,360,000 | 3.2 | 7.1% | 60,000 |
| `native:NamedNodeMap` | 2,894,384 | 2.76 | 6.1% | 70,000 |
| `native:Text` | 2,880,000 | 2.75 | 6.1% | 30,000 |
| `closure:` | 2,799,972 | 2.67 | 5.9% | 99,999 |
| `object:r1` | 2,640,000 | 2.52 | 5.6% | 30,000 |
| `object:system / Context` | 2,359,980 | 2.25 | 5% | 99,999 |
| `string` | 2,113,796 | 2.02 | 4.5% | 39,954 |
| `object:Map` | 1,920,032 | 1.83 | 4.1% | 120,002 |
| `native:CSSStyleDeclaration` | 1,720,432 | 1.64 | 3.7% | 30,000 |
| `array:(object elements)` | 1,520,476 | 1.45 | 3.2% | 70,015 |
| `native:<x-text class="col-id">` | 1,520,000 | 1.45 | 3.2% | 10,000 |
| `native:<x-text class="col-label">` | 1,520,000 | 1.45 | 3.2% | 10,000 |
| `native:<x-text class="col-remove">` | 1,520,000 | 1.45 | 3.2% | 10,000 |
| `native:<x-view class="row">` | 1,520,000 | 1.45 | 3.2% | 10,000 |
| `native:<raw-text text="x">` | 1,480,000 | 1.41 | 3.1% | 10,000 |
| `object:rQ` | 1,440,000 | 1.37 | 3.1% | 60,000 |
| `object:c` | 1,280,000 | 1.22 | 2.7% | 40,000 |
| `object:Array` | 1,120,304 | 1.07 | 2.4% | 70,019 |

## Leak or high-water mark — `afterClear2` minus `afterClear`

A second create-and-clear on the same page. The first cycle cannot separate a
bucket that is still holding data from one that grew a backing store and kept
it; this one can. A bucket here at roughly its cycle-one size grows once per
cycle and is unbounded. A bucket absent here took its capacity once and is
reusing it, and the cycle-one row is a high-water mark rather than a leak.

Second cycle: create 1630.6 ms, clear 207.2 ms; scalar moved
**0.57 MiB**
(596,148 bytes).

| bucket | bytes | MiB | share of retained | nodes |
|---|---:|---:|---:|---:|
| `native:system / JSArrayBufferData` | 17,301,504 | 16.5 | 2902.2% | 0 |
| `array:` | 1,044,232 | 1 | 175.2% | -33 |
| `hidden` | 8,710 | 0.01 | 1.5% | -132 |
| `native:NodeList` | 1,568 | 0 | 0.3% | 0 |
| `native:TaskAttributionTiming` | 1,280 | 0 | 0.2% | 10 |
| `native:PerformanceLongTaskTiming` | 1,120 | 0 | 0.2% | 10 |
| `object shape:system / Map` | 960 | 0 | 0.2% | 24 |
| `array:(object elements)` | 784 | 0 | 0.1% | 38 |
| `native:PerformanceLongAnimationFrameTiming` | 720 | 0 | 0.1% | 5 |
| `native:PerformanceScriptTiming` | 448 | 0 | 0.1% | 4 |
| `object shape:system / PrototypeInfo` | 252 | 0 | 0% | 7 |
| `object:Object` | 208 | 0 | 0% | 9 |
| `native:<slot name="inline-truncation">` | 192 | 0 | 0% | 0 |
| `native:<slot part="slot">` | 192 | 0 | 0% | 0 |
| `object shape:system / TransitionArray` | 136 | 0 | 0% | 2 |
| `object shape:system / WeakArrayList` | 84 | 0 | 0% | 3 |
| `object shape:(enum cache)` | 72 | 0 | 0% | 4 |
| `object:Array` | 64 | 0 | 0% | 4 |
| `object shape:system / Cell` | 48 | 0 | 0% | 6 |
| `object shape:system / EnumCache` | 24 | 0 | 0% | 2 |

Beyond the top 25: **0 MiB** across
0 further buckets, and it names no owner either.
