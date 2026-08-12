# Element PAPI boundary decomposition — Octane vs ReactLynx vs Vue vdom+IFR+ET

- measured: 2026-08-12T19:08:50.013Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.5-fc-v20; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 1.23/1.07/0.57 (1/5/15m), end 1.11/1.27/0.99
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

| host call | octane | react | vue-vdom |
|---|---:|---:|---:|
| `__AddEvent` | 2,000 | 2,000 | 2,000 |
| `__AppendElement` | 7,000 | 6,000 | 4,000 |
| `__CreateRawText` | 3,000 | 2,000 | 0 |
| `__CreateText` | 3,000 | 3,000 | 3,000 |
| `__CreateView` | 1,000 | 1,000 | 1,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetAttribute` | 0 | 3,000 | 7,000 |
| `__SetCSSId` | 0 | 0 | 4,000 |
| `__SetClasses` | 4,000 | 4,000 | 4,000 |
| **total host calls** | 20,001 | 21,001 | 25,001 |
| **host calls per row** | 20 | 21 | 25 |

| measure | octane | react | vue-vdom |
|---|---:|---:|---:|
| wall ms, control | 147.9 | 135.1 | 159.6 |
| wall ms, counts build | 143 | 138.6 | 157.6 |
| wall ms, timed build | 164.2 | 150.6 | 179.7 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 35.2 | 30.7 | 41.3 |
| host op time ms, timed | 96.9 | 94 | 107.5 |
| host ms per call, timed | 0.00484 | 0.00448 | 0.0043 |
| flush time ms, timed | 0.1 | 0.1 | 0.1 |
| off-boundary ms, timed | 31.9 | 26.3 | 29.8 |
| counts-build overhead | 0.967× | 1.026× | 0.987× |
| timed-build overhead | 1.11× | 1.115× | 1.126× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react | vue-vdom |
|---|---:|---:|---:|
| slice start → paint ms, control | 30.2 | 15.7 | 22.3 |
| slice start → paint ms, counts | 32.4 | 17.7 | 29.2 |
| start delay ms | 19.2 | 7 | 16.1 |
| host calls | 195 | 114 | 144 |
| `__FlushElementTree` calls | 2 | 1 | 2 |
| host op time ms, timed | 3 | 2.7 | 3.3 |
| off-boundary ms, timed | 4.6 | 1.2 | 3.1 |
| counts-build overhead | 1.073× | 1.127× | 1.309× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 18.9 | 17.9–19.8 | 7.9% |
| papi_create | 60.1 | 57–65.9 | 25.0% |
| papi_props | 10.7 | 8.4–11.2 | 4.4% |
| papi_events | 5.9 | 5.6–6.7 | 2.5% |
| papi_topology | 6.6 | 6.2–7.7 | 2.7% |
| papi_read | 2 | 1.7–2.6 | 0.8% |
| papi_flush | 13.2 | 12.8–13.5 | 5.5% |
| off_boundary | 122.8 | 120.2–133.4 | 51.1% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 19.4 ms. Wall 211.5 ms control / 216.7 ms counts / 240.5 ms timed; overhead 1.025× counts, 1.137× timed.

FCP@1000 for `react`: **not measured** — the vendored ReactLynx bundle is a fixed black-box artifact, and a pre-populated first screen is a build-time define of the app source; rebuilding the reference would change the bundle hash the featured runs recorded.

FCP@1000 for `vue-vdom`: **not measured** — the vendored Vue vdom+IFR+ET bundle is a fixed black-box artifact; see the ReactLynx note.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 178.1 ms on the control pages; its direct pre-populated FCP@1000 is 211.5 ms — an excess of **33.4 ms (18.8%)** for the same rendered result. The counts build agrees: 175.4 ms composed against 216.7 ms direct.

The first-screen path issues 31.2 host calls per row against the create path's 20, and flushes 2 times against 1. The excess is 10,999 calls, 11 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 7,042 | 0 | +7,042 |
| `__InsertElementBefore` | 7,041 | 0 | +7,041 |
| `__SetAttribute` | 4,028 | 0 | +4,028 |
| `__SetClasses` | 4,028 | 4,000 | +28 |
| `__CreateView` | 1,015 | 1,000 | +15 |
| `__CreateRawText` | 3,013 | 3,000 | +13 |
| `__CreateText` | 3,013 | 3,000 | +13 |
| `__AddEvent` | 2,012 | 2,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |
| `__AppendElement` | 0 | 7,000 | -7,000 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 18.9 | 34.9 | -16 |
| papi_create | 60.1 | 62.7 | -2.6 |
| papi_props | 10.7 | 8.1 | +2.6 |
| papi_events | 5.9 | 5.6 | +0.3 |
| papi_topology | 6.6 | 20.5 | -13.9 |
| papi_read | 2 | 0 | +2 |
| papi_flush | 13.2 | 0.1 | +13.1 |
| off_boundary | 122.8 | 31.9 | +90.9 |

### Octane − `react`, create@1000

Certified wall-clock delta: 12.8 ms on the control pages, 4.4 ms on the counts build. The attribution below runs on the timed build, whose delta is 13.6 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -4.5 | -32.9% | NO-GO | 20001 vs 21001 host calls at 0.0045 ms/op (reference rate) |
| Flush cadence | 0 | -0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 3.4 | 25.0% | GO | 34.9 vs 31.5 ms to the first host call |
| Per-element creation stream shape | 7.4 | 54.2% | GO | 0.0048 vs 0.0045 ms of host time per call |
| Framework script and browser paint outside the host boundary | 5.6 | 41.2% | GO | 31.9 vs 26.3 ms off the host boundary |
| **median non-additivity** | 1.7 | 12.5% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react`, startup

Certified wall-clock delta: 14.7 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.9 | 12.1% | GO | 195 vs 114 host calls at 0.0237 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 12.4 | 78.0% | GO | 19.2 vs 6.8 ms to the first host call |
| Per-element creation stream shape | -1.6 | -10.2% | NO-GO | 0.0154 vs 0.0237 ms of host time per call |
| Framework script and browser paint outside the host boundary | 3.4 | 21.4% | GO | 4.6 vs 1.2 ms off the host boundary |
| **median non-additivity** | -0.2 | 1.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, create@1000

Certified wall-clock delta: -11.7 ms on the control pages, -14.6 ms on the counts build. The attribution below runs on the timed build, whose delta is -15.5 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -21.5 | n/a | NO-GO | 20001 vs 25001 host calls at 0.0043 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -9.7 | n/a | NO-GO | 34.9 vs 44.6 ms to the first host call |
| Per-element creation stream shape | 10.9 | n/a | NO-GO | 0.0048 vs 0.0043 ms of host time per call |
| Framework script and browser paint outside the host boundary | 2.1 | n/a | NO-GO | 31.9 vs 29.8 ms off the host boundary |
| **median non-additivity** | 2.7 | 17.4% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, startup

Certified wall-clock delta: 3.2 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.2 | 31.6% | GO | 195 vs 144 host calls at 0.0229 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 2.6 | 70.3% | GO | 19.2 vs 16.6 ms to the first host call |
| Per-element creation stream shape | -1.5 | -39.7% | NO-GO | 0.0154 vs 0.0229 ms of host time per call |
| Framework script and browser paint outside the host boundary | 1.5 | 40.5% | GO | 4.6 vs 3.1 ms off the host boundary |
| **median non-additivity** | -0.1 | 2.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

## 10,000 rows

### Host call counts and flush cadence — create@10000

| host call | octane | react | vue-vdom |
|---|---:|---:|---:|
| `__AddEvent` | 20,000 | 20,000 | 20,000 |
| `__AppendElement` | 70,000 | 60,000 | 40,000 |
| `__CreateRawText` | 30,000 | 20,000 | 0 |
| `__CreateText` | 30,000 | 30,000 | 30,000 |
| `__CreateView` | 10,000 | 10,000 | 10,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetAttribute` | 0 | 30,000 | 70,000 |
| `__SetCSSId` | 0 | 0 | 40,000 |
| `__SetClasses` | 40,000 | 40,000 | 40,000 |
| **total host calls** | 200,001 | 210,001 | 250,001 |
| **host calls per row** | 20 | 21 | 25 |

| measure | octane | react | vue-vdom |
|---|---:|---:|---:|
| wall ms, control | 1214.1 | 1226.9 | 1414.4 |
| wall ms, counts build | 1248.9 | 1268 | 1454.8 |
| wall ms, timed build | 1345 | 1317.7 | 1559.4 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 171.7 | 230.7 | 322.7 |
| host op time ms, timed | 886.6 | 815.7 | 968 |
| host ms per call, timed | 0.00443 | 0.00388 | 0.00387 |
| flush time ms, timed | 0 | 0.1 | 0.1 |
| off-boundary ms, timed | 270.6 | 270.7 | 297.4 |
| counts-build overhead | 1.029× | 1.033× | 1.029× |
| timed-build overhead | 1.108× | 1.074× | 1.103× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react | vue-vdom |
|---|---:|---:|---:|
| slice start → paint ms, control | 28.8 | 17.6 | 26 |
| slice start → paint ms, counts | 27.9 | 13.5 | 24.9 |
| start delay ms | 19.2 | 8.4 | 17.5 |
| host calls | 195 | 114 | 144 |
| `__FlushElementTree` calls | 2 | 1 | 2 |
| host op time ms, timed | 3.3 | 3 | 3 |
| off-boundary ms, timed | 4.9 | 4.1 | 2.2 |
| counts-build overhead | 0.969× | 0.767× | 0.958× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19.7 | 19.4–22.8 | 1.0% |
| papi_create | 514.9 | 505.7–550.1 | 27.3% |
| papi_props | 90.4 | 83.6–112.6 | 4.8% |
| papi_events | 30.8 | 30.1–34 | 1.6% |
| papi_topology | 73.6 | 70.9–80.1 | 3.9% |
| papi_read | 18.4 | 16.5–19.8 | 1.0% |
| papi_flush | 146.1 | 126.1–177.3 | 7.8% |
| off_boundary | 1001 | 949.5–1025.6 | 53.1% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 18.8 ms. Wall 1660.5 ms control / 1697.1 ms counts / 1885 ms timed; overhead 1.022× counts, 1.135× timed.

FCP@10000 for `react`: **not measured** — the vendored ReactLynx bundle is a fixed black-box artifact, and a pre-populated first screen is a build-time define of the app source; rebuilding the reference would change the bundle hash the featured runs recorded.

FCP@10000 for `vue-vdom`: **not measured** — the vendored Vue vdom+IFR+ET bundle is a fixed black-box artifact; see the ReactLynx note.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1242.9 ms on the control pages; its direct pre-populated FCP@10000 is 1660.5 ms — an excess of **417.6 ms (33.6%)** for the same rendered result. The counts build agrees: 1276.8 ms composed against 1697.1 ms direct.

The first-screen path issues 31.02 host calls per row against the create path's 20, and flushes 2 times against 1. The excess is 109,999 calls, 11 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 70,042 | 0 | +70,042 |
| `__InsertElementBefore` | 70,041 | 0 | +70,041 |
| `__SetAttribute` | 40,028 | 0 | +40,028 |
| `__SetClasses` | 40,028 | 40,000 | +28 |
| `__CreateView` | 10,015 | 10,000 | +15 |
| `__CreateRawText` | 30,013 | 30,000 | +13 |
| `__CreateText` | 30,013 | 30,000 | +13 |
| `__AddEvent` | 20,012 | 20,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |
| `__AppendElement` | 0 | 70,000 | -70,000 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 19.7 | 183.1 | -163.4 |
| papi_create | 514.9 | 608.5 | -93.6 |
| papi_props | 90.4 | 67 | +23.4 |
| papi_events | 30.8 | 34.9 | -4.1 |
| papi_topology | 73.6 | 176.2 | -102.6 |
| papi_read | 18.4 | 0 | +18.4 |
| papi_flush | 146.1 | 0 | +146.1 |
| off_boundary | 1001 | 270.6 | +730.4 |

### Octane − `react`, create@10000

Certified wall-clock delta: -12.8 ms on the control pages, -19.1 ms on the counts build. The attribution below runs on the timed build, whose delta is 27.3 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -38.8 | -142.3% | NO-GO | 200001 vs 210001 host calls at 0.0039 ms/op (reference rate) |
| Flush cadence | -0.1 | -0.4% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -42.8 | -156.8% | NO-GO | 183.1 vs 225.9 ms to the first host call |
| Per-element creation stream shape | 109.7 | 402.0% | GO | 0.0044 vs 0.0039 ms of host time per call |
| Framework script and browser paint outside the host boundary | -0.1 | -0.4% | NO-GO | 270.6 vs 270.7 ms off the host boundary |
| **median non-additivity** | -0.6 | 2.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react`, startup

Certified wall-clock delta: 14.4 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 2.1 | 12.8% | GO | 195 vs 114 host calls at 0.0263 ms/op (reference rate) |
| Flush cadence | -0.1 | -0.6% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 11.4 | 68.7% | GO | 18.4 vs 7.0 ms to the first host call |
| Per-element creation stream shape | -1.8 | -11.0% | NO-GO | 0.0169 vs 0.0263 ms of host time per call |
| Framework script and browser paint outside the host boundary | 0.8 | 4.8% | NO-GO | 4.9 vs 4.1 ms off the host boundary |
| **median non-additivity** | 4.2 | 25.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, create@10000

Certified wall-clock delta: -200.3 ms on the control pages, -205.9 ms on the counts build. The attribution below runs on the timed build, whose delta is -214.4 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -193.6 | n/a | NO-GO | 200001 vs 250001 host calls at 0.0039 ms/op (reference rate) |
| Flush cadence | -0.1 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -132.3 | n/a | NO-GO | 183.1 vs 315.4 ms to the first host call |
| Per-element creation stream shape | 112.2 | n/a | NO-GO | 0.0044 vs 0.0039 ms of host time per call |
| Framework script and browser paint outside the host boundary | -26.8 | n/a | NO-GO | 270.6 vs 297.4 ms off the host boundary |
| **median non-additivity** | 26.2 | 12.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, startup

Certified wall-clock delta: 3 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.1 | 14.6% | GO | 195 vs 144 host calls at 0.0208 ms/op (reference rate) |
| Flush cadence | -0.1 | -1.4% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 1.5 | 20.5% | GO | 18.4 vs 16.9 ms to the first host call |
| Per-element creation stream shape | -0.8 | -10.4% | NO-GO | 0.0169 vs 0.0208 ms of host time per call |
| Framework script and browser paint outside the host boundary | 2.7 | 37.0% | GO | 4.9 vs 2.2 ms off the host boundary |
| **median non-additivity** | 2.9 | 39.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

## 30,000 rows

### Host call counts and flush cadence — create@30000

| host call | octane | react | vue-vdom |
|---|---:|---:|---:|
| `__AddEvent` | 60,000 | 60,000 | 60,000 |
| `__AppendElement` | 210,000 | 180,000 | 120,000 |
| `__CreateRawText` | 90,000 | 60,000 | 0 |
| `__CreateText` | 90,000 | 90,000 | 90,000 |
| `__CreateView` | 30,000 | 30,000 | 30,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetAttribute` | 0 | 90,000 | 210,000 |
| `__SetCSSId` | 0 | 0 | 120,000 |
| `__SetClasses` | 120,000 | 120,000 | 120,000 |
| **total host calls** | 600,001 | 630,001 | 750,001 |
| **host calls per row** | 20 | 21 | 25 |

| measure | octane | react | vue-vdom |
|---|---:|---:|---:|
| wall ms, control | 3516.2 | 3403.1 | 4411.9 |
| wall ms, counts build | 3491 | 3311.3 | 4351.6 |
| wall ms, timed build | 3865 | 3647.9 | 4632.7 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 480 | 550.2 | 921 |
| host op time ms, timed | 2591.4 | 2490.6 | 2921.3 |
| host ms per call, timed | 0.00432 | 0.00395 | 0.0039 |
| flush time ms, timed | 0.1 | 0 | 0.1 |
| off-boundary ms, timed | 831.9 | 655.2 | 821.1 |
| counts-build overhead | 0.993× | 0.973× | 0.986× |
| timed-build overhead | 1.099× | 1.072× | 1.05× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react | vue-vdom |
|---|---:|---:|---:|
| slice start → paint ms, control | 29.5 | 14 | 24.2 |
| slice start → paint ms, counts | 27.8 | 16.2 | 23.8 |
| start delay ms | 19.6 | 7.1 | 17.7 |
| host calls | 195 | 114 | 144 |
| `__FlushElementTree` calls | 2 | 1 | 2 |
| host op time ms, timed | 3.4 | 3.1 | 3.5 |
| off-boundary ms, timed | 4.7 | 1 | 2.6 |
| counts-build overhead | 0.942× | 1.157× | 0.983× |

### `octane` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19 | 18.3–23 | 0.3% |
| papi_create | 1778.5 | 1598.7–1825.7 | 31.1% |
| papi_props | 296.6 | 272–447.5 | 5.2% |
| papi_events | 84.6 | 81.6–104.6 | 1.5% |
| papi_topology | 246.7 | 235.7–273.5 | 4.3% |
| papi_read | 51.8 | 49.3–62.6 | 0.9% |
| papi_flush | 497.6 | 468.2–580.8 | 8.7% |
| off_boundary | 2684.6 | 2662.7–2880.4 | 46.9% |

Host calls 930,195 (31.01 per row), 2 `__FlushElementTree`, start delay 18.9 ms. Wall 5142.3 ms control / 5221.4 ms counts / 5719.7 ms timed; overhead 1.015× counts, 1.112× timed.

FCP@30000 for `react`: **not measured** — the vendored ReactLynx bundle is a fixed black-box artifact, and a pre-populated first screen is a build-time define of the app source; rebuilding the reference would change the bundle hash the featured runs recorded.

FCP@30000 for `vue-vdom`: **not measured** — the vendored Vue vdom+IFR+ET bundle is a fixed black-box artifact; see the ReactLynx note.

### Octane internal control — first-screen path vs create path @30000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 3545.7 ms on the control pages; its direct pre-populated FCP@30000 is 5142.3 ms — an excess of **1596.6 ms (45.0%)** for the same rendered result. The counts build agrees: 3518.8 ms composed against 5221.4 ms direct.

The first-screen path issues 31.01 host calls per row against the create path's 20, and flushes 2 times against 1. The excess is 329,999 calls, 11 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 210,042 | 0 | +210,042 |
| `__InsertElementBefore` | 210,041 | 0 | +210,041 |
| `__SetAttribute` | 120,028 | 0 | +120,028 |
| `__SetClasses` | 120,028 | 120,000 | +28 |
| `__CreateView` | 30,015 | 30,000 | +15 |
| `__CreateRawText` | 90,013 | 90,000 | +13 |
| `__CreateText` | 90,013 | 90,000 | +13 |
| `__AddEvent` | 60,012 | 60,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |
| `__AppendElement` | 0 | 210,000 | -210,000 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 19 | 448.3 | -429.3 |
| papi_create | 1778.5 | 1782.6 | -4.1 |
| papi_props | 296.6 | 201.4 | +95.2 |
| papi_events | 84.6 | 94.6 | -10 |
| papi_topology | 246.7 | 512.8 | -266.1 |
| papi_read | 51.8 | 0 | +51.8 |
| papi_flush | 497.6 | 0.1 | +497.5 |
| off_boundary | 2684.6 | 831.9 | +1852.7 |

### Octane − `react`, create@30000

Certified wall-clock delta: 113.1 ms on the control pages, 179.7 ms on the counts build. The attribution below runs on the timed build, whose delta is 217.1 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -118.6 | -54.6% | NO-GO | 600001 vs 630001 host calls at 0.0040 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -125.3 | -57.7% | NO-GO | 448.3 vs 573.6 ms to the first host call |
| Per-element creation stream shape | 219.4 | 101.1% | GO | 0.0043 vs 0.0040 ms of host time per call |
| Framework script and browser paint outside the host boundary | 176.7 | 81.4% | GO | 831.9 vs 655.2 ms off the host boundary |
| **median non-additivity** | 64.8 | 29.8% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react`, startup

Certified wall-clock delta: 11.6 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 2.2 | 15.2% | GO | 195 vs 114 host calls at 0.0272 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.7% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 11.3 | 77.9% | GO | 19.0 vs 7.7 ms to the first host call |
| Per-element creation stream shape | -1.9 | -13.1% | NO-GO | 0.0174 vs 0.0272 ms of host time per call |
| Framework script and browser paint outside the host boundary | 3.7 | 25.5% | GO | 4.7 vs 1.0 ms off the host boundary |
| **median non-additivity** | -0.9 | 6.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, create@30000

Certified wall-clock delta: -895.7 ms on the control pages, -860.6 ms on the counts build. The attribution below runs on the timed build, whose delta is -767.7 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -584.3 | n/a | NO-GO | 600001 vs 750001 host calls at 0.0039 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -456.7 | n/a | NO-GO | 448.3 vs 905.0 ms to the first host call |
| Per-element creation stream shape | 254.4 | n/a | NO-GO | 0.0043 vs 0.0039 ms of host time per call |
| Framework script and browser paint outside the host boundary | 10.8 | n/a | NO-GO | 831.9 vs 821.1 ms off the host boundary |
| **median non-additivity** | 8.1 | 1.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, startup

Certified wall-clock delta: 4 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.2 | 17.0% | GO | 195 vs 144 host calls at 0.0243 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 2.5 | 34.2% | GO | 19.0 vs 16.5 ms to the first host call |
| Per-element creation stream shape | -1.3 | -18.4% | NO-GO | 0.0174 vs 0.0243 ms of host time per call |
| Framework script and browser paint outside the host boundary | 2.1 | 28.8% | GO | 4.7 vs 2.6 ms off the host boundary |
| **median non-additivity** | 2.8 | 38.4% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 30,000 projected | 1,000 direct | 10,000 direct | 30,000 direct |
|---|---:|---:|---:|---:|---:|---:|
| octane | 178.1 | 1242.9 | 3545.7 | 211.5 | 1660.5 | 5142.3 |
| react | 150.8 | 1244.5 | 3417.1 | not measured | not measured | not measured |
| vue-vdom | 181.9 | 1440.4 | 4436.1 | not measured | not measured | not measured |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | 30,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---:|---|
| octane | 20 | 20 | 20 | 0.0% | yes |
| react | 21 | 21 | 21 | 0.0% | yes |
| vue-vdom | 25 | 25 | 25 | 0.0% | yes |

