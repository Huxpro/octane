# Element PAPI boundary decomposition — Octane vs Octane (main-thread program) vs octane-mts-program-control

- measured: 2026-08-31T14:49:02.041Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v22; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.13/0.39/0.49 (1/5/15m), end 1.59/1.48/1.12
- repetitions: n=11 per variant per cell; variants: control, counts, timed
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
| wall ms, control | 138.3 | 137.2 | 139.4 |
| wall ms, counts build | 149 | 147.7 | 150.9 |
| wall ms, timed build | 159.8 | 158.6 | 167.7 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 34 | 33.1 | 35.2 |
| host op time ms, timed | 97.1 | 98.5 | 104.1 |
| host ms per call, timed | 0.00511 | 0.00518 | 0.00548 |
| flush time ms, timed | 0 | 0 | 0 |
| off-boundary ms, timed | 29.6 | 29.3 | 26.5 |
| counts-build overhead | 1.077× | 1.077× | 1.082× |
| timed-build overhead | 1.155× | 1.156× | 1.203× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-mts-program | octane-mts-program-control |
|---|---:|---:|---:|
| slice start → paint ms, control | 32.3 | 30.1 | 33.8 |
| slice start → paint ms, counts | 33.6 | 29.8 | 30.9 |
| start delay ms | 23.2 | 23.3 | 23.4 |
| host calls | 169 | 113 | 113 |
| `__FlushElementTree` calls | 2 | 2 | 2 |
| host op time ms, timed | 3.2 | 2.8 | 2.9 |
| off-boundary ms, timed | 3.6 | 3.8 | 2.5 |
| counts-build overhead | 1.04× | 0.99× | 0.914× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 23.7 | 22–29.5 | 10.9% |
| papi_create | 58.9 | 55.7–75.6 | 27.1% |
| papi_props | 17.7 | 13.8–23.1 | 8.1% |
| papi_events | 7.7 | 5.8–9.3 | 3.5% |
| papi_topology | 7.9 | 6.3–8.9 | 3.6% |
| papi_read | 3 | 2.3–3.5 | 1.4% |
| papi_flush | 18 | 12.7–19.9 | 8.3% |
| off_boundary | 81.8 | 73.7–120 | 37.7% |

Host calls 29,169 (29.17 per row), 2 `__FlushElementTree`, start delay 23.6 ms. Wall 196.1 ms control / 198.2 ms counts / 217.2 ms timed; overhead 1.011× counts, 1.108× timed.

### `octane-mts-program` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 23.9 | 22.2–27.6 | 15.3% |
| papi_create | 59.3 | 53.3–67.5 | 38.0% |
| papi_props | 11.7 | 9.9–14.5 | 7.5% |
| papi_events | 7.4 | 6.5–8.6 | 4.7% |
| papi_topology | 6.9 | 5.4–7.8 | 4.4% |
| papi_read | 0.1 | 0–0.2 | 0.1% |
| papi_flush | 11.7 | 11.5–13.8 | 7.5% |
| off_boundary | 35.2 | 31.1–36.9 | 22.6% |

Host calls 19,113 (19.11 per row), 2 `__FlushElementTree`, start delay 22.9 ms. Wall 136.8 ms control / 141.5 ms counts / 155.9 ms timed; overhead 1.034× counts, 1.14× timed.

### `octane-mts-program-control` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 23.6 | 22.4–26.7 | 14.9% |
| papi_create | 57.1 | 51.5–61.4 | 36.1% |
| papi_props | 13.7 | 10.6–16.2 | 8.7% |
| papi_events | 7.3 | 6.2–9.2 | 4.6% |
| papi_topology | 6.3 | 5.5–9 | 4.0% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_flush | 11.9 | 11.2–12.4 | 7.5% |
| off_boundary | 35.4 | 32.2–38.7 | 22.4% |

Host calls 19,113 (19.11 per row), 2 `__FlushElementTree`, start delay 23.1 ms. Wall 139 ms control / 139.2 ms counts / 158.1 ms timed; overhead 1.001× counts, 1.137× timed.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 170.6 ms on the control pages; its direct pre-populated FCP@1000 is 196.1 ms — an excess of **25.5 ms (14.9%)** for the same rendered result. The counts build agrees: 182.6 ms composed against 198.2 ms direct.

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
| start_delay | 23.7 | 33.9 | -10.2 |
| papi_create | 58.9 | 57.1 | +1.8 |
| papi_props | 17.7 | 13.7 | +4 |
| papi_events | 7.7 | 6.7 | +1 |
| papi_topology | 7.9 | 19.6 | -11.7 |
| papi_read | 3 | 0 | +3 |
| papi_flush | 18 | 0 | +18 |
| off_boundary | 81.8 | 29.6 | +52.2 |

### Octane − `octane-mts-program`, create@1000

Certified wall-clock delta: 1.1 ms on the control pages, 1.3 ms on the counts build. The attribution below runs on the timed build, whose delta is 1.2 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 19001 vs 19001 host calls at 0.0052 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -0.6 | -50.0% | NO-GO | 33.9 vs 34.5 ms to the first host call |
| Per-element creation stream shape | -1.4 | -116.7% | NO-GO | 0.0051 vs 0.0052 ms of host time per call |
| Framework script and browser paint outside the host boundary | 0.3 | 25.0% | GO | 29.6 vs 29.3 ms off the host boundary |
| **median non-additivity** | 2.9 | 241.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: 3.8 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.4 | 69.4% | GO | 169 vs 113 host calls at 0.0248 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -0.3 | -15.0% | NO-GO | 24.1 vs 24.4 ms to the first host call |
| Per-element creation stream shape | -1 | -49.4% | NO-GO | 0.0189 vs 0.0248 ms of host time per call |
| Framework script and browser paint outside the host boundary | -0.2 | -10.0% | NO-GO | 3.6 vs 3.8 ms off the host boundary |
| **median non-additivity** | 2.1 | 105.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, FCP@1000

Certified wall-clock delta: 59.3 ms on the control pages, 56.7 ms on the counts build. The attribution below runs on the timed build, whose delta is 61.3 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 44.9 | 73.3% | GO | 29169 vs 19113 host calls at 0.0045 ms/op (reference rate) |
| Flush cadence | 6.3 | 10.3% | GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -0.2 | -0.3% | NO-GO | 23.7 vs 23.9 ms to the first host call |
| Per-element creation stream shape | -35.1 | -57.3% | NO-GO | 0.0033 vs 0.0045 ms of host time per call |
| Framework script and browser paint outside the host boundary | 46.6 | 76.0% | GO | 81.8 vs 35.2 ms off the host boundary |
| **median non-additivity** | -1.2 | 2.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, create@1000

Certified wall-clock delta: -1.1 ms on the control pages, -1.9 ms on the counts build. The attribution below runs on the timed build, whose delta is -7.9 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | n/a | NO-GO | 19001 vs 19001 host calls at 0.0055 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -0.2 | n/a | NO-GO | 33.9 vs 34.1 ms to the first host call |
| Per-element creation stream shape | -7 | n/a | NO-GO | 0.0051 vs 0.0055 ms of host time per call |
| Framework script and browser paint outside the host boundary | 3.1 | n/a | NO-GO | 29.6 vs 26.5 ms off the host boundary |
| **median non-additivity** | -3.8 | 48.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, startup

Certified wall-clock delta: 2.7 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.4 | 110.5% | GO | 169 vs 113 host calls at 0.0257 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -0.4 | -30.8% | NO-GO | 24.1 vs 24.5 ms to the first host call |
| Per-element creation stream shape | -1.1 | -87.5% | NO-GO | 0.0189 vs 0.0257 ms of host time per call |
| Framework script and browser paint outside the host boundary | 1.1 | 84.6% | GO | 3.6 vs 2.5 ms off the host boundary |
| **median non-additivity** | 0.3 | 23.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, FCP@1000

Certified wall-clock delta: 57.1 ms on the control pages, 59 ms on the counts build. The attribution below runs on the timed build, whose delta is 59.1 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 44.4 | 75.1% | GO | 29169 vs 19113 host calls at 0.0044 ms/op (reference rate) |
| Flush cadence | 6.1 | 10.3% | GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 0.1 | 0.2% | NO-GO | 23.7 vs 23.6 ms to the first host call |
| Per-element creation stream shape | -33.6 | -56.9% | NO-GO | 0.0033 vs 0.0044 ms of host time per call |
| Framework script and browser paint outside the host boundary | 46.4 | 78.5% | GO | 81.8 vs 35.4 ms off the host boundary |
| **median non-additivity** | -4.3 | 7.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

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
| wall ms, control | 1131.5 | 1127.1 | 1127.3 |
| wall ms, counts build | 1212.3 | 1199.7 | 1174.5 |
| wall ms, timed build | 1372.8 | 1364 | 1312.1 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 171.2 | 168.1 | 173.4 |
| host op time ms, timed | 908.8 | 902.6 | 883.9 |
| host ms per call, timed | 0.00478 | 0.00475 | 0.00465 |
| flush time ms, timed | 0.1 | 0.1 | 0.1 |
| off-boundary ms, timed | 296.3 | 288.6 | 271.3 |
| counts-build overhead | 1.071× | 1.064× | 1.042× |
| timed-build overhead | 1.213× | 1.21× | 1.164× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-mts-program | octane-mts-program-control |
|---|---:|---:|---:|
| slice start → paint ms, control | 31.8 | 31 | 30 |
| slice start → paint ms, counts | 34.1 | 32.9 | 31.3 |
| start delay ms | 23.6 | 23.9 | 23.3 |
| host calls | 169 | 113 | 113 |
| `__FlushElementTree` calls | 2 | 2 | 2 |
| host op time ms, timed | 3.5 | 2.7 | 2.8 |
| off-boundary ms, timed | 5.9 | 2.2 | 2.8 |
| counts-build overhead | 1.072× | 1.061× | 1.043× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 24 | 22.1–26.3 | 1.4% |
| papi_create | 576.4 | 525.8–644.7 | 33.8% |
| papi_props | 168.6 | 154.7–196 | 9.9% |
| papi_events | 48.1 | 45.3–56 | 2.8% |
| papi_topology | 76.1 | 66.4–79.4 | 4.5% |
| papi_read | 26.8 | 23.9–28.5 | 1.6% |
| papi_flush | 143.7 | 137.5–153.3 | 8.4% |
| off_boundary | 641.4 | 577.8–676.6 | 37.6% |

Host calls 290,169 (29.02 per row), 2 `__FlushElementTree`, start delay 23.1 ms. Wall 1354.6 ms control / 1454.8 ms counts / 1704.8 ms timed; overhead 1.074× counts, 1.259× timed.

### `octane-mts-program` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 23.6 | 21.5–27.6 | 2.0% |
| papi_create | 525 | 490.1–588 | 45.6% |
| papi_props | 101.2 | 90–116.6 | 8.8% |
| papi_events | 43.5 | 39.4–47.8 | 3.8% |
| papi_topology | 66.3 | 60.7–74.3 | 5.8% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_flush | 141.6 | 121.2–162.2 | 12.3% |
| off_boundary | 245.8 | 218.9–270.6 | 21.3% |

Host calls 190,113 (19.01 per row), 2 `__FlushElementTree`, start delay 23.5 ms. Wall 950.1 ms control / 1025.8 ms counts / 1152.1 ms timed; overhead 1.08× counts, 1.213× timed.

### `octane-mts-program-control` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 23.5 | 22.2–28.2 | 2.1% |
| papi_create | 527.5 | 480.9–548.5 | 46.3% |
| papi_props | 97.1 | 87.4–130.9 | 8.5% |
| papi_events | 43.8 | 38.9–46.5 | 3.8% |
| papi_topology | 68 | 63.6–75.4 | 6.0% |
| papi_read | 0 | 0–1.3 | 0.0% |
| papi_flush | 150.5 | 130–166.9 | 13.2% |
| off_boundary | 234.9 | 220.3–253.6 | 20.6% |

Host calls 190,113 (19.01 per row), 2 `__FlushElementTree`, start delay 23.7 ms. Wall 972.7 ms control / 1034 ms counts / 1139.9 ms timed; overhead 1.063× counts, 1.172× timed.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1163.3 ms on the control pages; its direct pre-populated FCP@10000 is 1354.6 ms — an excess of **191.3 ms (16.4%)** for the same rendered result. The counts build agrees: 1246.4 ms composed against 1454.8 ms direct.

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
| start_delay | 24 | 175 | -151 |
| papi_create | 576.4 | 576.1 | +0.3 |
| papi_props | 168.6 | 110.9 | +57.7 |
| papi_events | 48.1 | 42 | +6.1 |
| papi_topology | 76.1 | 179.8 | -103.7 |
| papi_read | 26.8 | 0 | +26.8 |
| papi_flush | 143.7 | 0.1 | +143.6 |
| off_boundary | 641.4 | 296.3 | +345.1 |

### Octane − `octane-mts-program`, create@10000

Certified wall-clock delta: 4.4 ms on the control pages, 12.6 ms on the counts build. The attribution below runs on the timed build, whose delta is 8.8 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 190001 vs 190001 host calls at 0.0048 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 0 | 0.0% | NO-GO | 175.0 vs 175.0 ms to the first host call |
| Per-element creation stream shape | 6.2 | 70.5% | GO | 0.0048 vs 0.0048 ms of host time per call |
| Framework script and browser paint outside the host boundary | 7.7 | 87.5% | GO | 296.3 vs 288.6 ms off the host boundary |
| **median non-additivity** | -5.1 | 58.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: 1.2 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.3 | 17.8% | GO | 169 vs 113 host calls at 0.0239 ms/op (reference rate) |
| Flush cadence | 0.1 | 1.3% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -0.2 | -2.7% | NO-GO | 23.7 vs 23.9 ms to the first host call |
| Per-element creation stream shape | -0.5 | -7.2% | NO-GO | 0.0207 vs 0.0239 ms of host time per call |
| Framework script and browser paint outside the host boundary | 3.7 | 49.3% | GO | 5.9 vs 2.2 ms off the host boundary |
| **median non-additivity** | 3.1 | 41.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, FCP@10000

Certified wall-clock delta: 404.5 ms on the control pages, 429 ms on the counts build. The attribution below runs on the timed build, whose delta is 552.7 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 387.4 | 70.1% | GO | 290169 vs 190113 host calls at 0.0039 ms/op (reference rate) |
| Flush cadence | 2.1 | 0.4% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 0.4 | 0.1% | NO-GO | 24.0 vs 23.6 ms to the first host call |
| Per-element creation stream shape | -227.4 | -41.1% | NO-GO | 0.0031 vs 0.0039 ms of host time per call |
| Framework script and browser paint outside the host boundary | 395.6 | 71.6% | GO | 641.4 vs 245.8 ms off the host boundary |
| **median non-additivity** | -5.4 | 1.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, create@10000

Certified wall-clock delta: 4.2 ms on the control pages, 37.8 ms on the counts build. The attribution below runs on the timed build, whose delta is 60.7 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 190001 vs 190001 host calls at 0.0047 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 6.4 | 10.5% | GO | 175.0 vs 168.6 ms to the first host call |
| Per-element creation stream shape | 24.9 | 41.0% | GO | 0.0048 vs 0.0047 ms of host time per call |
| Framework script and browser paint outside the host boundary | 25 | 41.2% | GO | 296.3 vs 271.3 ms off the host boundary |
| **median non-additivity** | 4.4 | 7.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, startup

Certified wall-clock delta: 2.8 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.4 | 25.2% | GO | 169 vs 113 host calls at 0.0248 ms/op (reference rate) |
| Flush cadence | 0.1 | 1.8% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 0.1 | 1.8% | NO-GO | 23.7 vs 23.6 ms to the first host call |
| Per-element creation stream shape | -0.7 | -12.5% | NO-GO | 0.0207 vs 0.0248 ms of host time per call |
| Framework script and browser paint outside the host boundary | 3.1 | 56.4% | GO | 5.9 vs 2.8 ms off the host boundary |
| **median non-additivity** | 1.5 | 27.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, FCP@10000

Certified wall-clock delta: 381.9 ms on the control pages, 420.8 ms on the counts build. The attribution below runs on the timed build, whose delta is 564.9 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 387.6 | 68.6% | GO | 290169 vs 190113 host calls at 0.0039 ms/op (reference rate) |
| Flush cadence | -6.8 | -1.2% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 0.5 | 0.1% | NO-GO | 24.0 vs 23.5 ms to the first host call |
| Per-element creation stream shape | -228 | -40.4% | NO-GO | 0.0031 vs 0.0039 ms of host time per call |
| Framework script and browser paint outside the host boundary | 406.5 | 72.0% | GO | 641.4 vs 234.9 ms off the host boundary |
| **median non-additivity** | 5.1 | 0.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 1,000 direct | 10,000 direct |
|---|---:|---:|---:|---:|
| octane | 170.6 | 1163.3 | 196.1 | 1354.6 |
| octane-mts-program | 167.3 | 1158.1 | 136.8 | 950.1 |
| octane-mts-program-control | 173.2 | 1157.3 | 139 | 972.7 |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---|
| octane | 19 | 19 | 0.0% | yes |
| octane-mts-program | 19 | 19 | 0.0% | yes |
| octane-mts-program-control | 19 | 19 | 0.0% | yes |

