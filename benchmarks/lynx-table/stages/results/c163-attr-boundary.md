# Element PAPI boundary decomposition — Octane vs Octane (main-thread program) vs L0 direct-emission prototype

- measured: 2026-08-25T21:22:47.814Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.39/1.47/1.73 (1/5/15m), end 1.51/1.54/1.69
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

| host call | octane | octane-mts-program | octane-direct |
|---|---:|---:|---:|
| `__AddEvent` | 2,000 | 2,000 | 2,000 |
| `__AppendElement` | 7,000 | 7,000 | 7,000 |
| `__CreateRawText` | 3,000 | 3,000 | 3,000 |
| `__CreateText` | 3,000 | 3,000 | 3,000 |
| `__CreateView` | 1,000 | 1,000 | 1,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetClasses` | 4,000 | 4,000 | 4,000 |
| **total host calls** | 20,001 | 20,001 | 20,001 |
| **host calls per row** | 20 | 20 | 20 |

| measure | octane | octane-mts-program | octane-direct |
|---|---:|---:|---:|
| wall ms, control | 137.6 | 135.7 | 109.1 |
| wall ms, counts build | 147.1 | 140.7 | 106.5 |
| wall ms, timed build | 157.4 | 158.1 | 126.2 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 31.9 | 31.8 | 2.8 |
| host op time ms, timed | 93.8 | 97.5 | 97.7 |
| host ms per call, timed | 0.00469 | 0.00487 | 0.00488 |
| flush time ms, timed | 0 | 0.1 | 0 |
| off-boundary ms, timed | 28.2 | 27.8 | 18.4 |
| counts-build overhead | 1.069× | 1.037× | 0.976× |
| timed-build overhead | 1.144× | 1.165× | 1.157× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-mts-program | octane-direct |
|---|---:|---:|---:|
| slice start → paint ms, control | 34.6 | 27.1 | 8.3 |
| slice start → paint ms, counts | 28.7 | 26.1 | 14.3 |
| start delay ms | 20.5 | 19.5 | 2.5 |
| host calls | 195 | 126 | 127 |
| `__FlushElementTree` calls | 2 | 2 | 2 |
| host op time ms, timed | 2.9 | 2.7 | 2.7 |
| off-boundary ms, timed | 4.5 | 7.3 | 5.8 |
| counts-build overhead | 0.829× | 0.963× | 1.723× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.1 | 19.3–21.8 | 9.5% |
| papi_create | 65.3 | 59–69.3 | 30.9% |
| papi_props | 12.4 | 10.4–13.7 | 5.9% |
| papi_events | 7.6 | 7–8.9 | 3.6% |
| papi_topology | 8.1 | 7.4–9.7 | 3.8% |
| papi_read | 2.8 | 2.7–4.9 | 1.3% |
| papi_flush | 16.5 | 16.3–18.2 | 7.8% |
| off_boundary | 76.9 | 73.9–78.4 | 36.4% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 19.9 ms. Wall 178.4 ms control / 189.2 ms counts / 211 ms timed; overhead 1.061× counts, 1.183× timed.

### `octane-mts-program` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.9 | 19.7–22.5 | 12.3% |
| papi_create | 64.7 | 57.6–71.7 | 37.9% |
| papi_props | 9.1 | 7.8–10.4 | 5.3% |
| papi_events | 7.1 | 5.9–8.3 | 4.2% |
| papi_topology | 7.5 | 7.3–8.9 | 4.4% |
| papi_read | 1 | 0.7–1.3 | 0.6% |
| papi_flush | 12.9 | 12.7–14.3 | 7.6% |
| off_boundary | 49.6 | 46–62.3 | 29.1% |

Host calls 22,126 (22.13 per row), 2 `__FlushElementTree`, start delay 20.1 ms. Wall 157.5 ms control / 162.4 ms counts / 170.5 ms timed; overhead 1.031× counts, 1.083× timed.

### `octane-direct` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 2.4 | 2.3–2.5 | 2.1% |
| papi_create | 58.9 | 57.3–60.2 | 51.0% |
| papi_props | 8 | 7.8–11 | 6.9% |
| papi_events | 6.3 | 4.9–6.7 | 5.4% |
| papi_topology | 6.4 | 6–7.3 | 5.5% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_flush | 15.8 | 15.3–18.3 | 13.7% |
| off_boundary | 18.7 | 17.8–19.4 | 16.2% |

Host calls 20,127 (20.13 per row), 2 `__FlushElementTree`, start delay 2.5 ms. Wall 98.7 ms control / 102.7 ms counts / 115.6 ms timed; overhead 1.041× counts, 1.171× timed.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 172.2 ms on the control pages; its direct pre-populated FCP@1000 is 178.4 ms — an excess of **6.2 ms (3.6%)** for the same rendered result. The counts build agrees: 175.8 ms composed against 189.2 ms direct.

The first-screen path issues 31.2 host calls per row against the create path's 20, and flushes 2 times against 1. The excess is 10,999 calls, 11 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 7,042 | 0 | +7,042 |
| `__SetAttribute` | 4,028 | 0 | +4,028 |
| `__AppendElement` | 7,041 | 7,000 | +41 |
| `__SetClasses` | 4,028 | 4,000 | +28 |
| `__CreateView` | 1,015 | 1,000 | +15 |
| `__CreateRawText` | 3,013 | 3,000 | +13 |
| `__CreateText` | 3,013 | 3,000 | +13 |
| `__AddEvent` | 2,012 | 2,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 20.1 | 33.4 | -13.3 |
| papi_create | 65.3 | 59.3 | +6 |
| papi_props | 12.4 | 8.9 | +3.5 |
| papi_events | 7.6 | 6.2 | +1.4 |
| papi_topology | 8.1 | 19.4 | -11.3 |
| papi_read | 2.8 | 0 | +2.8 |
| papi_flush | 16.5 | 0 | +16.5 |
| off_boundary | 76.9 | 28.2 | +48.7 |

### Octane − `octane-mts-program`, create@1000

Certified wall-clock delta: 1.9 ms on the control pages, 6.4 ms on the counts build. The attribution below runs on the timed build, whose delta is -0.7 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | n/a | NO-GO | 20001 vs 20001 host calls at 0.0049 ms/op (reference rate) |
| Flush cadence | -0.1 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 0.5 | n/a | NO-GO | 33.4 vs 32.9 ms to the first host call |
| Per-element creation stream shape | -3.7 | n/a | NO-GO | 0.0047 vs 0.0049 ms of host time per call |
| Framework script and browser paint outside the host boundary | 0.4 | n/a | NO-GO | 28.2 vs 27.8 ms off the host boundary |
| **median non-additivity** | 2.2 | 314.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: 2.6 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.5 | n/a | NO-GO | 195 vs 126 host calls at 0.0214 ms/op (reference rate) |
| Flush cadence | -0.1 | n/a | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -1 | n/a | NO-GO | 20.0 vs 21.0 ms to the first host call |
| Per-element creation stream shape | -1.3 | n/a | NO-GO | 0.0149 vs 0.0214 ms of host time per call |
| Framework script and browser paint outside the host boundary | -2.8 | n/a | NO-GO | 4.5 vs 7.3 ms off the host boundary |
| **median non-additivity** | -0.6 | 13.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, create@1000

Certified wall-clock delta: 28.5 ms on the control pages, 40.6 ms on the counts build. The attribution below runs on the timed build, whose delta is 31.2 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 20001 vs 20001 host calls at 0.0049 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 30.8 | 98.7% | GO | 33.4 vs 2.6 ms to the first host call |
| Per-element creation stream shape | -3.9 | -12.5% | NO-GO | 0.0047 vs 0.0049 ms of host time per call |
| Framework script and browser paint outside the host boundary | 9.8 | 31.4% | GO | 28.2 vs 18.4 ms off the host boundary |
| **median non-additivity** | -5.5 | 17.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, startup

Certified wall-clock delta: 14.4 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.4 | 8.8% | NO-GO | 195 vs 127 host calls at 0.0213 ms/op (reference rate) |
| Flush cadence | 0 | -0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 17.6 | 107.3% | GO | 20.0 vs 2.4 ms to the first host call |
| Per-element creation stream shape | -1.2 | -7.6% | NO-GO | 0.0149 vs 0.0213 ms of host time per call |
| Framework script and browser paint outside the host boundary | -1.3 | -7.9% | NO-GO | 4.5 vs 5.8 ms off the host boundary |
| **median non-additivity** | -0.1 | 0.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

## 10,000 rows

### Host call counts and flush cadence — create@10000

| host call | octane | octane-mts-program | octane-direct |
|---|---:|---:|---:|
| `__AddEvent` | 20,000 | 20,000 | 20,000 |
| `__AppendElement` | 70,000 | 70,000 | 70,000 |
| `__CreateRawText` | 30,000 | 30,000 | 30,000 |
| `__CreateText` | 30,000 | 30,000 | 30,000 |
| `__CreateView` | 10,000 | 10,000 | 10,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetClasses` | 40,000 | 40,000 | 40,000 |
| **total host calls** | 200,001 | 200,001 | 200,001 |
| **host calls per row** | 20 | 20 | 20 |

| measure | octane | octane-mts-program | octane-direct |
|---|---:|---:|---:|
| wall ms, control | 1144.8 | 1151.7 | 904 |
| wall ms, counts build | 1211.7 | 1195.2 | 949.7 |
| wall ms, timed build | 1336.7 | 1381.6 | 1076.6 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 170.5 | 171.2 | 9.5 |
| host op time ms, timed | 886.9 | 927.6 | 904.8 |
| host ms per call, timed | 0.00443 | 0.00464 | 0.00452 |
| flush time ms, timed | 0 | 0 | 0.1 |
| off-boundary ms, timed | 261.9 | 267.9 | 175.3 |
| counts-build overhead | 1.058× | 1.038× | 1.051× |
| timed-build overhead | 1.168× | 1.2× | 1.191× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-mts-program | octane-direct |
|---|---:|---:|---:|
| slice start → paint ms, control | 27.9 | 33.8 | 7.4 |
| slice start → paint ms, counts | 28.5 | 25.7 | 12.8 |
| start delay ms | 19.8 | 19.5 | 2.6 |
| host calls | 195 | 126 | 127 |
| `__FlushElementTree` calls | 2 | 2 | 2 |
| host op time ms, timed | 2.9 | 2.6 | 3.1 |
| off-boundary ms, timed | 3.4 | 3 | 4.4 |
| counts-build overhead | 1.022× | 0.76× | 1.73× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21 | 19.6–21.8 | 1.3% |
| papi_create | 576.1 | 553.1–648.7 | 35.0% |
| papi_props | 116.3 | 109.9–122.9 | 7.1% |
| papi_events | 42 | 39.1–46.2 | 2.5% |
| papi_topology | 76.9 | 74.1–81.9 | 4.7% |
| papi_read | 31.8 | 29.7–34.6 | 1.9% |
| papi_flush | 150.5 | 143.9–184.3 | 9.1% |
| off_boundary | 597.4 | 571.3–679 | 36.3% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 20 ms. Wall 1331.1 ms control / 1420.8 ms counts / 1647.3 ms timed; overhead 1.067× counts, 1.238× timed.

### `octane-mts-program` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.3 | 19.7–21.3 | 1.6% |
| papi_create | 571 | 552.1–582.3 | 43.9% |
| papi_props | 66.8 | 65–75.1 | 5.1% |
| papi_events | 38.4 | 37.2–61 | 3.0% |
| papi_topology | 69.2 | 68.4–70.8 | 5.3% |
| papi_read | 8.2 | 7.9–9.9 | 0.6% |
| papi_flush | 137.5 | 126.5–146.3 | 10.6% |
| off_boundary | 379.3 | 349.9–397.6 | 29.1% |

Host calls 220,126 (22.01 per row), 2 `__FlushElementTree`, start delay 19.7 ms. Wall 1092 ms control / 1169 ms counts / 1301.3 ms timed; overhead 1.071× counts, 1.192× timed.

### `octane-direct` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 2.5 | 2.1–2.8 | 0.2% |
| papi_create | 548.7 | 542–566.8 | 53.9% |
| papi_props | 71.2 | 66.6–74.8 | 7.0% |
| papi_events | 33.8 | 31.9–35.3 | 3.3% |
| papi_topology | 56.3 | 52.9–62.4 | 5.5% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_flush | 139.4 | 135.8–152 | 13.7% |
| off_boundary | 172 | 167.7–186.7 | 16.9% |

Host calls 200,127 (20.01 per row), 2 `__FlushElementTree`, start delay 2.5 ms. Wall 850.1 ms control / 906.1 ms counts / 1018.2 ms timed; overhead 1.066× counts, 1.198× timed.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1172.7 ms on the control pages; its direct pre-populated FCP@10000 is 1331.1 ms — an excess of **158.4 ms (13.5%)** for the same rendered result. The counts build agrees: 1240.2 ms composed against 1420.8 ms direct.

The first-screen path issues 31.02 host calls per row against the create path's 20, and flushes 2 times against 1. The excess is 109,999 calls, 11 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 70,042 | 0 | +70,042 |
| `__SetAttribute` | 40,028 | 0 | +40,028 |
| `__AppendElement` | 70,041 | 70,000 | +41 |
| `__SetClasses` | 40,028 | 40,000 | +28 |
| `__CreateView` | 10,015 | 10,000 | +15 |
| `__CreateRawText` | 30,013 | 30,000 | +13 |
| `__CreateText` | 30,013 | 30,000 | +13 |
| `__AddEvent` | 20,012 | 20,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 21 | 167.4 | -146.4 |
| papi_create | 576.1 | 588.9 | -12.8 |
| papi_props | 116.3 | 74.8 | +41.5 |
| papi_events | 42 | 37.5 | +4.5 |
| papi_topology | 76.9 | 185.7 | -108.8 |
| papi_read | 31.8 | 0 | +31.8 |
| papi_flush | 150.5 | 0 | +150.5 |
| off_boundary | 597.4 | 261.9 | +335.5 |

### Octane − `octane-mts-program`, create@10000

Certified wall-clock delta: -6.9 ms on the control pages, 16.5 ms on the counts build. The attribution below runs on the timed build, whose delta is -44.9 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | n/a | NO-GO | 200001 vs 200001 host calls at 0.0046 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -8.4 | n/a | NO-GO | 167.4 vs 175.8 ms to the first host call |
| Per-element creation stream shape | -40.7 | n/a | NO-GO | 0.0044 vs 0.0046 ms of host time per call |
| Framework script and browser paint outside the host boundary | -6 | n/a | NO-GO | 261.9 vs 267.9 ms off the host boundary |
| **median non-additivity** | 10.2 | 22.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: 2.8 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.4 | 47.5% | GO | 195 vs 126 host calls at 0.0206 ms/op (reference rate) |
| Flush cadence | 0.1 | 3.3% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -0.4 | -13.3% | NO-GO | 19.6 vs 20.0 ms to the first host call |
| Per-element creation stream shape | -1.1 | -37.5% | NO-GO | 0.0149 vs 0.0206 ms of host time per call |
| Framework script and browser paint outside the host boundary | 0.4 | 13.3% | GO | 3.4 vs 3.0 ms off the host boundary |
| **median non-additivity** | 2.6 | 86.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, create@10000

Certified wall-clock delta: 240.8 ms on the control pages, 262 ms on the counts build. The attribution below runs on the timed build, whose delta is 260.1 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 200001 vs 200001 host calls at 0.0045 ms/op (reference rate) |
| Flush cadence | -0.1 | -0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 158.5 | 60.9% | GO | 167.4 vs 8.9 ms to the first host call |
| Per-element creation stream shape | -17.9 | -6.9% | NO-GO | 0.0044 vs 0.0045 ms of host time per call |
| Framework script and browser paint outside the host boundary | 86.6 | 33.3% | GO | 261.9 vs 175.3 ms off the host boundary |
| **median non-additivity** | 33 | 12.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, startup

Certified wall-clock delta: 15.7 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.7 | 8.7% | NO-GO | 195 vs 127 host calls at 0.0244 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.5% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 17 | 89.0% | GO | 19.6 vs 2.6 ms to the first host call |
| Per-element creation stream shape | -1.9 | -9.7% | NO-GO | 0.0149 vs 0.0244 ms of host time per call |
| Framework script and browser paint outside the host boundary | -1 | -5.2% | NO-GO | 3.4 vs 4.4 ms off the host boundary |
| **median non-additivity** | 3.2 | 16.8% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 1,000 direct | 10,000 direct |
|---|---:|---:|---:|---:|
| octane | 172.2 | 1172.7 | 178.4 | 1331.1 |
| octane-mts-program | 162.8 | 1185.5 | 157.5 | 1092 |
| octane-direct | 117.4 | 911.4 | 98.7 | 850.1 |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---|
| octane | 20 | 20 | 0.0% | yes |
| octane-mts-program | 20 | 20 | 0.0% | yes |
| octane-direct | 20 | 20 | 0.0% | yes |

