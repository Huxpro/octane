# Element PAPI boundary decomposition — Octane vs Octane (main-thread program) vs octane-mts-program-control

- measured: 2026-08-31T14:27:16.263Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v22; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.76/0.39/0.30 (1/5/15m), end 1.60/1.22/0.72
- repetitions: n=5 per variant per cell; variants: control, counts, timed
- protocol: fresh page per sample; control/counts/timed order rotates across repetitions in one host window; startup and create are measured in the same page load; the probe is host-side, so every variant runs the same framework bundle
- references: https://github.com/Huxpro/vue-lynx @ 02376ecd1cd62d3797ff1de1209d82dc2f9d91d9; the vendored bundles are used as built, and the probe changes no bundle byte

## Observation contract

The probe wraps the single `Object.assign` with which `@lynx-js/web-core` installs the Element PAPI onto the hidden main-thread script realm, so it observes the host boundary rather than any framework. Every cell is measured by that identical instrument, and no bundle — including the vendored ReactLynx and Vue references — is modified or rebuilt.

Each timed window obeys one identity:

```
wall = start_delay + Σ host-group self time + off_boundary
```

`start_delay` is the observed gap from the window's start boundary to the first host call. Each host group is directly observed and exclusive: a host call re-entered through a framework callback is counted once. `off_boundary` is the named exclusive remainder — framework script, the browser's own style, layout, paint, and observer-frame delay, and the timed probe's own bookkeeping — because the host exposes no boundary separating those. `__FlushElementTree` self time covers the synchronous publication Web Core performs inside it; the browser's layout and paint that follow it stay in `off_boundary`.

Host call counts, flush cadence, and start delay are read from the counts build, whose wall clock carries no per-call clock reads. The timed build supplies host self time. Both builds count identically by construction, and the agreement is reported per cell as the control on the timed build's cost.

Two window predicates differ and the difference is not corrected away: the create window resolves on a shallow scan of the row container, while the FCP window resolves on the composed-tree content count `stages/run.mjs` already uses. The FCP predicate is the more expensive walk, so an FCP window carries up to one polling frame of that walk that a create window does not. Host call counts are exact and carry no such term.

## 1,000 rows

### Host call counts and flush cadence — create@1000

| host call | octane | octane-mts-program | octane-mts-program-control |
|---|---:|---:|---:|
| `__AddEvent` | 2,000 | 2,000 | 2,000 |
| `__AppendElement` | 6,000 | 6,000 | 6,000 |
| `__CreateRawText` | 2,000 | 2,000 | 2,000 |
| `__CreateText` | 3,000 | 3,000 | 3,000 |
| `__CreateView` | 1,000 | 1,000 | 1,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetAttribute` | 1,000 | 1,000 | 1,000 |
| `__SetClasses` | 4,000 | 4,000 | 4,000 |
| **total host calls** | 19,001 | 19,001 | 19,001 |
| **host calls per row** | 19 | 19 | 19 |

| measure | octane | octane-mts-program | octane-mts-program-control |
|---|---:|---:|---:|
| wall ms, control | 137.8 | 138.9 | 137.6 |
| wall ms, counts build | 152.5 | 148.6 | 147.2 |
| wall ms, timed build | 163.2 | 161 | 159.4 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 33.8 | 33.6 | 34.8 |
| host op time ms, timed | 99.4 | 96.2 | 95.1 |
| host ms per call, timed | 0.00523 | 0.00506 | 0.005 |
| flush time ms, timed | 0.1 | 0 | 0.1 |
| off-boundary ms, timed | 28.3 | 29.2 | 25.1 |
| counts-build overhead | 1.107× | 1.07× | 1.07× |
| timed-build overhead | 1.184× | 1.159× | 1.158× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-mts-program | octane-mts-program-control |
|---|---:|---:|---:|
| slice start → paint ms, control | 30.1 | 31 | 32.1 |
| slice start → paint ms, counts | 32.4 | 30.8 | 32.3 |
| start delay ms | 23.9 | 24.1 | 23.5 |
| host calls | 169 | 113 | 113 |
| `__FlushElementTree` calls | 2 | 2 | 2 |
| host op time ms, timed | 2.7 | 2.7 | 2.5 |
| off-boundary ms, timed | 10.3 | 2.9 | 5.4 |
| counts-build overhead | 1.076× | 0.994× | 1.006× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 23.8 | 23.5–26 | 11.0% |
| papi_create | 59.7 | 54.7–65.6 | 27.5% |
| papi_props | 18 | 16.7–19.3 | 8.3% |
| papi_events | 7.8 | 7.4–9.3 | 3.6% |
| papi_topology | 7.3 | 6.8–8 | 3.4% |
| papi_read | 3.1 | 3.1–3.7 | 1.4% |
| papi_flush | 17 | 12.6–20.3 | 7.8% |
| off_boundary | 82.1 | 76.7–87 | 37.9% |

Host calls 29,169 (29.17 per row), 2 `__FlushElementTree`, start delay 24.1 ms. Wall 189.8 ms control / 201.6 ms counts / 216.9 ms timed; overhead 1.062× counts, 1.143× timed.

### `octane-mts-program` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 23.3 | 22.2–25.2 | 15.3% |
| papi_create | 54.7 | 53.3–56.8 | 35.8% |
| papi_props | 12.7 | 10.7–16 | 8.3% |
| papi_events | 7.3 | 6.8–7.4 | 4.8% |
| papi_topology | 7.2 | 6.5–7.9 | 4.7% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_flush | 12.5 | 11.6–13.3 | 8.2% |
| off_boundary | 37.7 | 32.3–38.1 | 24.7% |

Host calls 19,113 (19.11 per row), 2 `__FlushElementTree`, start delay 23.4 ms. Wall 132.6 ms control / 138.6 ms counts / 152.7 ms timed; overhead 1.045× counts, 1.152× timed.

### `octane-mts-program-control` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 25.2 | 23.6–26.6 | 16.2% |
| papi_create | 58.3 | 55.2–59.6 | 37.5% |
| papi_props | 12.1 | 10.5–14 | 7.8% |
| papi_events | 6.9 | 6.3–7.6 | 4.4% |
| papi_topology | 6.6 | 6.3–8.4 | 4.2% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_flush | 11.8 | 11.2–12.4 | 7.6% |
| off_boundary | 36.5 | 31.9–41.2 | 23.5% |

Host calls 19,113 (19.11 per row), 2 `__FlushElementTree`, start delay 25.1 ms. Wall 140 ms control / 144.3 ms counts / 155.5 ms timed; overhead 1.031× counts, 1.111× timed.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 167.9 ms on the control pages; its direct pre-populated FCP@1000 is 189.8 ms — an excess of **21.9 ms (13.0%)** for the same rendered result. The counts build agrees: 184.9 ms composed against 201.6 ms direct.

The first-screen path issues 29.17 host calls per row against the create path's 19, and flushes 2 times against 1. The excess is 9,999 calls, 10 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 6,029 | 0 | +6,029 |
| `__SetAttribute` | 5,041 | 1,000 | +4,041 |
| `__AppendElement` | 6,028 | 6,000 | +28 |
| `__SetClasses` | 4,028 | 4,000 | +28 |
| `__CreateView` | 1,015 | 1,000 | +15 |
| `__CreateText` | 3,013 | 3,000 | +13 |
| `__AddEvent` | 2,012 | 2,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |
| `__CreateRawText` | 2,000 | 2,000 | 0 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 23.8 | 35.5 | -11.7 |
| papi_create | 59.7 | 59.7 | 0 |
| papi_props | 18 | 13.7 | +4.3 |
| papi_events | 7.8 | 6.2 | +1.6 |
| papi_topology | 7.3 | 19.8 | -12.5 |
| papi_read | 3.1 | 0 | +3.1 |
| papi_flush | 17 | 0.1 | +16.9 |
| off_boundary | 82.1 | 28.3 | +53.8 |

### Octane − `octane-mts-program`, create@1000

Certified wall-clock delta: -1.1 ms on the control pages, 3.9 ms on the counts build. The attribution below runs on the timed build, whose delta is 2.2 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 19001 vs 19001 host calls at 0.0051 ms/op (reference rate) |
| Flush cadence | 0.1 | 4.5% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 1.1 | 50.0% | GO | 35.5 vs 34.4 ms to the first host call |
| Per-element creation stream shape | 3.2 | 145.5% | GO | 0.0052 vs 0.0051 ms of host time per call |
| Framework script and browser paint outside the host boundary | -0.9 | -40.9% | NO-GO | 28.3 vs 29.2 ms off the host boundary |
| **median non-additivity** | -1.3 | 59.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: 1.6 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.3 | 18.6% | GO | 169 vs 113 host calls at 0.0239 ms/op (reference rate) |
| Flush cadence | -0.1 | -1.4% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -0.5 | -6.9% | NO-GO | 23.0 vs 23.5 ms to the first host call |
| Per-element creation stream shape | -1.3 | -18.6% | NO-GO | 0.0160 vs 0.0239 ms of host time per call |
| Framework script and browser paint outside the host boundary | 7.4 | 102.8% | GO | 10.3 vs 2.9 ms off the host boundary |
| **median non-additivity** | 0.4 | 5.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, FCP@1000

Certified wall-clock delta: 57.2 ms on the control pages, 63 ms on the counts build. The attribution below runs on the timed build, whose delta is 64.2 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 43.1 | 67.1% | GO | 29169 vs 19113 host calls at 0.0043 ms/op (reference rate) |
| Flush cadence | 4.5 | 7.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 0.5 | 0.8% | NO-GO | 23.8 vs 23.3 ms to the first host call |
| Per-element creation stream shape | -29.1 | -45.3% | NO-GO | 0.0033 vs 0.0043 ms of host time per call |
| Framework script and browser paint outside the host boundary | 44.4 | 69.2% | GO | 82.1 vs 37.7 ms off the host boundary |
| **median non-additivity** | 0.8 | 1.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, create@1000

Certified wall-clock delta: 0.2 ms on the control pages, 5.3 ms on the counts build. The attribution below runs on the timed build, whose delta is 3.8 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 19001 vs 19001 host calls at 0.0050 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 1.2 | 31.6% | GO | 35.5 vs 34.3 ms to the first host call |
| Per-element creation stream shape | 4.3 | 113.2% | GO | 0.0052 vs 0.0050 ms of host time per call |
| Framework script and browser paint outside the host boundary | 3.2 | 84.2% | GO | 28.3 vs 25.1 ms off the host boundary |
| **median non-additivity** | -4.9 | 128.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, startup

Certified wall-clock delta: 0.1 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.2 | 47.6% | GO | 169 vs 113 host calls at 0.0221 ms/op (reference rate) |
| Flush cadence | -0.1 | -3.8% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -1.9 | -73.1% | NO-GO | 23.0 vs 24.9 ms to the first host call |
| Per-element creation stream shape | -1 | -40.0% | NO-GO | 0.0160 vs 0.0221 ms of host time per call |
| Framework script and browser paint outside the host boundary | 4.9 | 188.5% | GO | 10.3 vs 5.4 ms off the host boundary |
| **median non-additivity** | -0.5 | 19.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, FCP@1000

Certified wall-clock delta: 49.8 ms on the control pages, 57.3 ms on the counts build. The attribution below runs on the timed build, whose delta is 61.4 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 44.1 | 71.9% | GO | 29169 vs 19113 host calls at 0.0044 ms/op (reference rate) |
| Flush cadence | 5.2 | 8.5% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -1.4 | -2.3% | NO-GO | 23.8 vs 25.2 ms to the first host call |
| Per-element creation stream shape | -32.1 | -52.3% | NO-GO | 0.0033 vs 0.0044 ms of host time per call |
| Framework script and browser paint outside the host boundary | 45.6 | 74.3% | GO | 82.1 vs 36.5 ms off the host boundary |
| **median non-additivity** | 0 | 0.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

## 10,000 rows

### Host call counts and flush cadence — create@10000

| host call | octane | octane-mts-program | octane-mts-program-control |
|---|---:|---:|---:|
| `__AddEvent` | 20,000 | 20,000 | 20,000 |
| `__AppendElement` | 60,000 | 60,000 | 60,000 |
| `__CreateRawText` | 20,000 | 20,000 | 20,000 |
| `__CreateText` | 30,000 | 30,000 | 30,000 |
| `__CreateView` | 10,000 | 10,000 | 10,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetAttribute` | 10,000 | 10,000 | 10,000 |
| `__SetClasses` | 40,000 | 40,000 | 40,000 |
| **total host calls** | 190,001 | 190,001 | 190,001 |
| **host calls per row** | 19 | 19 | 19 |

| measure | octane | octane-mts-program | octane-mts-program-control |
|---|---:|---:|---:|
| wall ms, control | 1130.9 | 1141.5 | 1130.1 |
| wall ms, counts build | 1257.4 | 1261.8 | 1219.1 |
| wall ms, timed build | 1299.4 | 1423.4 | 1371.2 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 173.6 | 169.2 | 168.9 |
| host op time ms, timed | 843.5 | 936.6 | 908 |
| host ms per call, timed | 0.00444 | 0.00493 | 0.00478 |
| flush time ms, timed | 0 | 0.1 | 0 |
| off-boundary ms, timed | 305.9 | 279.8 | 281.2 |
| counts-build overhead | 1.112× | 1.105× | 1.079× |
| timed-build overhead | 1.149× | 1.247× | 1.213× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-mts-program | octane-mts-program-control |
|---|---:|---:|---:|
| slice start → paint ms, control | 35.8 | 28.4 | 34.4 |
| slice start → paint ms, counts | 32.4 | 32.1 | 37.5 |
| start delay ms | 25 | 23.9 | 24.4 |
| host calls | 169 | 113 | 113 |
| `__FlushElementTree` calls | 2 | 2 | 2 |
| host op time ms, timed | 3 | 2.9 | 2.7 |
| off-boundary ms, timed | 4.2 | 2.5 | 2.2 |
| counts-build overhead | 0.905× | 1.13× | 1.09× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 23.8 | 22.8–25.1 | 1.4% |
| papi_create | 563.9 | 519.3–661.4 | 34.0% |
| papi_props | 165 | 150.9–180.1 | 9.9% |
| papi_events | 48.3 | 43–54.1 | 2.9% |
| papi_topology | 77.3 | 68.6–82 | 4.7% |
| papi_read | 26.4 | 25.5–27.7 | 1.6% |
| papi_flush | 141.5 | 135.1–178.1 | 8.5% |
| off_boundary | 613 | 580.4–669.4 | 37.0% |

Host calls 290,169 (29.02 per row), 2 `__FlushElementTree`, start delay 23.8 ms. Wall 1384.6 ms control / 1480.6 ms counts / 1658.3 ms timed; overhead 1.069× counts, 1.198× timed.

### `octane-mts-program` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 23.4 | 22.2–24.6 | 2.1% |
| papi_create | 516.5 | 510.8–528.9 | 45.7% |
| papi_props | 92.1 | 87.2–98.7 | 8.1% |
| papi_events | 42.2 | 41.7–44.9 | 3.7% |
| papi_topology | 66.5 | 65.1–73.1 | 5.9% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_flush | 141.3 | 115.4–156 | 12.5% |
| off_boundary | 238.4 | 232.4–256.5 | 21.1% |

Host calls 190,113 (19.01 per row), 2 `__FlushElementTree`, start delay 23.5 ms. Wall 955.5 ms control / 1043.1 ms counts / 1131 ms timed; overhead 1.092× counts, 1.184× timed.

### `octane-mts-program-control` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 25.8 | 22.9–26.8 | 2.1% |
| papi_create | 556.3 | 529.6–558 | 46.0% |
| papi_props | 101.5 | 91.5–159 | 8.4% |
| papi_events | 47.7 | 45–50.5 | 3.9% |
| papi_topology | 69.3 | 67–70.9 | 5.7% |
| papi_read | 0 | 0–0.4 | 0.0% |
| papi_flush | 153.8 | 127.9–177.5 | 12.7% |
| off_boundary | 234.3 | 228.2–303.2 | 19.4% |

Host calls 190,113 (19.01 per row), 2 `__FlushElementTree`, start delay 23.5 ms. Wall 953.8 ms control / 1035.4 ms counts / 1209.6 ms timed; overhead 1.086× counts, 1.268× timed.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1166.7 ms on the control pages; its direct pre-populated FCP@10000 is 1384.6 ms — an excess of **217.9 ms (18.7%)** for the same rendered result. The counts build agrees: 1289.8 ms composed against 1480.6 ms direct.

The first-screen path issues 29.02 host calls per row against the create path's 19, and flushes 2 times against 1. The excess is 99,999 calls, 10 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 60,029 | 0 | +60,029 |
| `__SetAttribute` | 50,041 | 10,000 | +40,041 |
| `__AppendElement` | 60,028 | 60,000 | +28 |
| `__SetClasses` | 40,028 | 40,000 | +28 |
| `__CreateView` | 10,015 | 10,000 | +15 |
| `__CreateText` | 30,013 | 30,000 | +13 |
| `__AddEvent` | 20,012 | 20,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |
| `__CreateRawText` | 20,000 | 20,000 | 0 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 23.8 | 165.2 | -141.4 |
| papi_create | 563.9 | 518 | +45.9 |
| papi_props | 165 | 105.8 | +59.2 |
| papi_events | 48.3 | 41.4 | +6.9 |
| papi_topology | 77.3 | 178.3 | -101 |
| papi_read | 26.4 | 0 | +26.4 |
| papi_flush | 141.5 | 0 | +141.5 |
| off_boundary | 613 | 305.9 | +307.1 |

### Octane − `octane-mts-program`, create@10000

Certified wall-clock delta: -10.6 ms on the control pages, -4.4 ms on the counts build. The attribution below runs on the timed build, whose delta is -124 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | n/a | NO-GO | 190001 vs 190001 host calls at 0.0049 ms/op (reference rate) |
| Flush cadence | -0.1 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -9.9 | n/a | NO-GO | 165.2 vs 175.1 ms to the first host call |
| Per-element creation stream shape | -93.1 | n/a | NO-GO | 0.0044 vs 0.0049 ms of host time per call |
| Framework script and browser paint outside the host boundary | 26.1 | n/a | NO-GO | 305.9 vs 279.8 ms off the host boundary |
| **median non-additivity** | -47 | 37.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: 0.3 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.4 | 35.1% | GO | 169 vs 113 host calls at 0.0257 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 1.6 | 39.0% | GO | 24.4 vs 22.8 ms to the first host call |
| Per-element creation stream shape | -1.3 | -32.6% | NO-GO | 0.0178 vs 0.0257 ms of host time per call |
| Framework script and browser paint outside the host boundary | 1.7 | 41.5% | GO | 4.2 vs 2.5 ms off the host boundary |
| **median non-additivity** | 0.7 | 17.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, FCP@10000

Certified wall-clock delta: 429.1 ms on the control pages, 437.5 ms on the counts build. The attribution below runs on the timed build, whose delta is 527.3 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 377.5 | 71.6% | GO | 290169 vs 190113 host calls at 0.0038 ms/op (reference rate) |
| Flush cadence | 0.2 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 0.4 | 0.1% | NO-GO | 23.8 vs 23.4 ms to the first host call |
| Per-element creation stream shape | -213.9 | -40.6% | NO-GO | 0.0030 vs 0.0038 ms of host time per call |
| Framework script and browser paint outside the host boundary | 374.6 | 71.0% | GO | 613.0 vs 238.4 ms off the host boundary |
| **median non-additivity** | -11.5 | 2.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, create@10000

Certified wall-clock delta: 0.8 ms on the control pages, 38.3 ms on the counts build. The attribution below runs on the timed build, whose delta is -71.8 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | n/a | NO-GO | 190001 vs 190001 host calls at 0.0048 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -10.7 | n/a | NO-GO | 165.2 vs 175.9 ms to the first host call |
| Per-element creation stream shape | -64.5 | n/a | NO-GO | 0.0044 vs 0.0048 ms of host time per call |
| Framework script and browser paint outside the host boundary | 24.7 | n/a | NO-GO | 305.9 vs 281.2 ms off the host boundary |
| **median non-additivity** | -21.3 | 29.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, startup

Certified wall-clock delta: -5.1 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.3 | 31.9% | GO | 169 vs 113 host calls at 0.0239 ms/op (reference rate) |
| Flush cadence | 0.1 | 2.4% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 0.2 | 4.8% | NO-GO | 24.4 vs 24.2 ms to the first host call |
| Per-element creation stream shape | -1 | -24.7% | NO-GO | 0.0178 vs 0.0239 ms of host time per call |
| Framework script and browser paint outside the host boundary | 2 | 47.6% | GO | 4.2 vs 2.2 ms off the host boundary |
| **median non-additivity** | 1.6 | 38.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, FCP@10000

Certified wall-clock delta: 430.8 ms on the control pages, 445.2 ms on the counts build. The attribution below runs on the timed build, whose delta is 448.7 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 407.8 | 90.9% | GO | 290169 vs 190113 host calls at 0.0041 ms/op (reference rate) |
| Flush cadence | -12.3 | -2.7% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -2 | -0.4% | NO-GO | 23.8 vs 25.8 ms to the first host call |
| Per-element creation stream shape | -301.7 | -67.2% | NO-GO | 0.0030 vs 0.0041 ms of host time per call |
| Framework script and browser paint outside the host boundary | 378.7 | 84.4% | GO | 613.0 vs 234.3 ms off the host boundary |
| **median non-additivity** | -21.8 | 4.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 1,000 direct | 10,000 direct |
|---|---:|---:|---:|---:|
| octane | 167.9 | 1166.7 | 189.8 | 1384.6 |
| octane-mts-program | 169.9 | 1169.9 | 132.6 | 955.5 |
| octane-mts-program-control | 169.7 | 1164.5 | 140 | 953.8 |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---|
| octane | 19 | 19 | 0.0% | yes |
| octane-mts-program | 19 | 19 | 0.0% | yes |
| octane-mts-program-control | 19 | 19 | 0.0% | yes |

