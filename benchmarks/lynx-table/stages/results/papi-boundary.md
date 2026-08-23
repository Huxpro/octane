# Element PAPI boundary decomposition — Octane vs ReactLynx vs Vue vdom+IFR+ET

- measured: 2026-08-23T23:18:52.655Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.43/1.39/1.13 (1/5/15m), end 1.39/1.61/1.38
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
| wall ms, control | 137.2 | 126.3 | 146.5 |
| wall ms, counts build | 144.7 | 131.8 | 158.1 |
| wall ms, timed build | 145.9 | 139.8 | 170.5 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 32.8 | 28.1 | 42.4 |
| host op time ms, timed | 83.6 | 87.9 | 102.2 |
| host ms per call, timed | 0.00418 | 0.00419 | 0.00409 |
| flush time ms, timed | 0 | 0 | 0.1 |
| off-boundary ms, timed | 32.2 | 26.5 | 27.5 |
| counts-build overhead | 1.055× | 1.044× | 1.079× |
| timed-build overhead | 1.063× | 1.107× | 1.164× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react | vue-vdom |
|---|---:|---:|---:|
| slice start → paint ms, control | 29.6 | 11 | 23.8 |
| slice start → paint ms, counts | 27.4 | 15.3 | 22.5 |
| start delay ms | 18.5 | 6.3 | 15.8 |
| host calls | 195 | 114 | 144 |
| `__FlushElementTree` calls | 2 | 1 | 2 |
| host op time ms, timed | 3 | 2.7 | 2.9 |
| off-boundary ms, timed | 3.7 | 6.8 | 8.4 |
| counts-build overhead | 0.926× | 1.391× | 0.945× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19.5 | 18.3–22.3 | 9.8% |
| papi_create | 61.2 | 55.5–69.8 | 30.8% |
| papi_props | 9 | 7.9–12.2 | 4.5% |
| papi_events | 6.4 | 5.8–7.5 | 3.2% |
| papi_topology | 5.3 | 4.5–6.1 | 2.7% |
| papi_read | 1.6 | 0.9–2.2 | 0.8% |
| papi_flush | 11.5 | 11–14.9 | 5.8% |
| off_boundary | 81.8 | 77.9–87.4 | 41.2% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 19.6 ms. Wall 182.9 ms control / 183.7 ms counts / 198.6 ms timed; overhead 1.004× counts, 1.086× timed.

FCP@1000 for `react`: **not measured** — the vendored ReactLynx bundle is a fixed black-box artifact, and a pre-populated first screen is a build-time define of the app source; rebuilding the reference would change the bundle hash the featured runs recorded.

FCP@1000 for `vue-vdom`: **not measured** — the vendored Vue vdom+IFR+ET bundle is a fixed black-box artifact; see the ReactLynx note.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 166.8 ms on the control pages; its direct pre-populated FCP@1000 is 182.9 ms — an excess of **16.1 ms (9.7%)** for the same rendered result. The counts build agrees: 172.1 ms composed against 183.7 ms direct.

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
| start_delay | 19.5 | 32.3 | -12.8 |
| papi_create | 61.2 | 54.7 | +6.5 |
| papi_props | 9 | 6.5 | +2.5 |
| papi_events | 6.4 | 5.6 | +0.8 |
| papi_topology | 5.3 | 16.8 | -11.5 |
| papi_read | 1.6 | 0 | +1.6 |
| papi_flush | 11.5 | 0 | +11.5 |
| off_boundary | 81.8 | 32.2 | +49.6 |

### Octane − `react`, create@1000

Certified wall-clock delta: 10.9 ms on the control pages, 12.9 ms on the counts build. The attribution below runs on the timed build, whose delta is 6.1 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -4.2 | -68.6% | NO-GO | 20001 vs 21001 host calls at 0.0042 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 4 | 65.6% | GO | 32.3 vs 28.3 ms to the first host call |
| Per-element creation stream shape | -0.1 | -1.9% | NO-GO | 0.0042 vs 0.0042 ms of host time per call |
| Framework script and browser paint outside the host boundary | 5.7 | 93.4% | GO | 32.2 vs 26.5 ms off the host boundary |
| **median non-additivity** | 0.7 | 11.5% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react`, startup

Certified wall-clock delta: 12.1 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.9 | 22.3% | GO | 195 vs 114 host calls at 0.0237 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 11.8 | 137.2% | GO | 18.6 vs 6.8 ms to the first host call |
| Per-element creation stream shape | -1.6 | -18.8% | NO-GO | 0.0154 vs 0.0237 ms of host time per call |
| Framework script and browser paint outside the host boundary | -3.1 | -36.0% | NO-GO | 3.7 vs 6.8 ms off the host boundary |
| **median non-additivity** | -0.4 | 4.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, create@1000

Certified wall-clock delta: -9.3 ms on the control pages, -13.4 ms on the counts build. The attribution below runs on the timed build, whose delta is -24.6 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -20.4 | n/a | NO-GO | 20001 vs 25001 host calls at 0.0041 ms/op (reference rate) |
| Flush cadence | -0.1 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -9.7 | n/a | NO-GO | 32.3 vs 42.0 ms to the first host call |
| Per-element creation stream shape | 1.8 | n/a | NO-GO | 0.0042 vs 0.0041 ms of host time per call |
| Framework script and browser paint outside the host boundary | 4.7 | n/a | NO-GO | 32.2 vs 27.5 ms off the host boundary |
| **median non-additivity** | -0.9 | 3.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, startup

Certified wall-clock delta: 4.9 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1 | n/a | NO-GO | 195 vs 144 host calls at 0.0201 ms/op (reference rate) |
| Flush cadence | 0.1 | n/a | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 3 | n/a | NO-GO | 18.6 vs 15.6 ms to the first host call |
| Per-element creation stream shape | -0.9 | n/a | NO-GO | 0.0154 vs 0.0201 ms of host time per call |
| Framework script and browser paint outside the host boundary | -4.7 | n/a | NO-GO | 3.7 vs 8.4 ms off the host boundary |
| **median non-additivity** | 0.5 | 50.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

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
| wall ms, control | 1108.5 | 1031.4 | 1298.7 |
| wall ms, counts build | 1131.4 | 1159.5 | 1323 |
| wall ms, timed build | 1249.8 | 1254.8 | 1518.7 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 163.5 | 215.9 | 302.9 |
| host op time ms, timed | 839.6 | 754.4 | 923.6 |
| host ms per call, timed | 0.0042 | 0.00359 | 0.00369 |
| flush time ms, timed | 0.1 | 0.1 | 0.1 |
| off-boundary ms, timed | 245.2 | 281.7 | 297.5 |
| counts-build overhead | 1.021× | 1.124× | 1.019× |
| timed-build overhead | 1.127× | 1.217× | 1.169× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react | vue-vdom |
|---|---:|---:|---:|
| slice start → paint ms, control | 24.6 | 11.7 | 26.9 |
| slice start → paint ms, counts | 33 | 18 | 21.9 |
| start delay ms | 19.8 | 7 | 15 |
| host calls | 195 | 114 | 144 |
| `__FlushElementTree` calls | 2 | 1 | 2 |
| host op time ms, timed | 2.9 | 2.5 | 3.1 |
| off-boundary ms, timed | 3.9 | 3.9 | 2 |
| counts-build overhead | 1.341× | 1.538× | 0.814× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 18.7 | 18.3–22.7 | 1.2% |
| papi_create | 550.2 | 526.2–556.6 | 35.3% |
| papi_props | 88 | 85.7–94.1 | 5.6% |
| papi_events | 35.7 | 32.7–36.3 | 2.3% |
| papi_topology | 54.7 | 51.6–56.8 | 3.5% |
| papi_read | 17.3 | 13.7–18.2 | 1.1% |
| papi_flush | 123.8 | 116.8–149.3 | 7.9% |
| off_boundary | 668.1 | 665.5–693.7 | 42.8% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 19.7 ms. Wall 1337.3 ms control / 1406 ms counts / 1560.3 ms timed; overhead 1.051× counts, 1.167× timed.

FCP@10000 for `react`: **not measured** — the vendored ReactLynx bundle is a fixed black-box artifact, and a pre-populated first screen is a build-time define of the app source; rebuilding the reference would change the bundle hash the featured runs recorded.

FCP@10000 for `vue-vdom`: **not measured** — the vendored Vue vdom+IFR+ET bundle is a fixed black-box artifact; see the ReactLynx note.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1133.1 ms on the control pages; its direct pre-populated FCP@10000 is 1337.3 ms — an excess of **204.2 ms (18.0%)** for the same rendered result. The counts build agrees: 1164.4 ms composed against 1406 ms direct.

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
| start_delay | 18.7 | 174.4 | -155.7 |
| papi_create | 550.2 | 582.8 | -32.6 |
| papi_props | 88 | 60 | +28 |
| papi_events | 35.7 | 32.7 | +3 |
| papi_topology | 54.7 | 164.1 | -109.4 |
| papi_read | 17.3 | 0 | +17.3 |
| papi_flush | 123.8 | 0.1 | +123.7 |
| off_boundary | 668.1 | 245.2 | +422.9 |

### Octane − `react`, create@10000

Certified wall-clock delta: 77.1 ms on the control pages, -28.1 ms on the counts build. The attribution below runs on the timed build, whose delta is -5 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -35.9 | n/a | NO-GO | 200001 vs 210001 host calls at 0.0036 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -42.2 | n/a | NO-GO | 174.4 vs 216.6 ms to the first host call |
| Per-element creation stream shape | 121.1 | n/a | NO-GO | 0.0042 vs 0.0036 ms of host time per call |
| Framework script and browser paint outside the host boundary | -36.5 | n/a | NO-GO | 245.2 vs 281.7 ms off the host boundary |
| **median non-additivity** | -11.5 | 230.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react`, startup

Certified wall-clock delta: 15 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.8 | 17.8% | GO | 195 vs 114 host calls at 0.0219 ms/op (reference rate) |
| Flush cadence | -0.1 | -1.0% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 10.6 | 106.0% | GO | 17.7 vs 7.1 ms to the first host call |
| Per-element creation stream shape | -1.4 | -13.8% | NO-GO | 0.0149 vs 0.0219 ms of host time per call |
| Framework script and browser paint outside the host boundary | 0 | -0.0% | NO-GO | 3.9 vs 3.9 ms off the host boundary |
| **median non-additivity** | -0.9 | 9.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, create@10000

Certified wall-clock delta: -190.2 ms on the control pages, -191.6 ms on the counts build. The attribution below runs on the timed build, whose delta is -268.9 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -184.7 | n/a | NO-GO | 200001 vs 250001 host calls at 0.0037 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -143.5 | n/a | NO-GO | 174.4 vs 317.9 ms to the first host call |
| Per-element creation stream shape | 100.7 | n/a | NO-GO | 0.0042 vs 0.0037 ms of host time per call |
| Framework script and browser paint outside the host boundary | -52.3 | n/a | NO-GO | 245.2 vs 297.5 ms off the host boundary |
| **median non-additivity** | 10.9 | 4.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, startup

Certified wall-clock delta: 11.1 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.1 | 22.0% | GO | 195 vs 144 host calls at 0.0215 ms/op (reference rate) |
| Flush cadence | -0.1 | -2.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 2 | 40.0% | GO | 17.7 vs 15.7 ms to the first host call |
| Per-element creation stream shape | -1.3 | -26.0% | NO-GO | 0.0149 vs 0.0215 ms of host time per call |
| Framework script and browser paint outside the host boundary | 1.9 | 38.0% | GO | 3.9 vs 2.0 ms off the host boundary |
| **median non-additivity** | 1.4 | 28.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

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
| wall ms, control | 3125.1 | 2985.3 | 3921.8 |
| wall ms, counts build | 3245.7 | 3030.9 | 3757 |
| wall ms, timed build | 3497.5 | 3338 | 4144.1 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 426.6 | 553.5 | 840.1 |
| host op time ms, timed | 2340 | 2225.8 | 2654.7 |
| host ms per call, timed | 0.0039 | 0.00353 | 0.00354 |
| flush time ms, timed | 0 | 0.1 | 0.1 |
| off-boundary ms, timed | 691.1 | 578.8 | 738.9 |
| counts-build overhead | 1.039× | 1.015× | 0.958× |
| timed-build overhead | 1.119× | 1.118× | 1.057× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react | vue-vdom |
|---|---:|---:|---:|
| slice start → paint ms, control | 30.7 | 17.6 | 22 |
| slice start → paint ms, counts | 26.9 | 13.5 | 29.9 |
| start delay ms | 19.3 | 7.1 | 15.7 |
| host calls | 195 | 114 | 144 |
| `__FlushElementTree` calls | 2 | 1 | 2 |
| host op time ms, timed | 2.6 | 2.9 | 2.7 |
| off-boundary ms, timed | 11.5 | 3.9 | 2.3 |
| counts-build overhead | 0.876× | 0.767× | 1.359× |

### `octane` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.1 | 18.9–20.9 | 0.4% |
| papi_create | 1729.1 | 1627.3–1811.2 | 37.6% |
| papi_props | 287.3 | 265.1–308.9 | 6.2% |
| papi_events | 97.8 | 91.1–101.3 | 2.1% |
| papi_topology | 162.2 | 158.8–176 | 3.5% |
| papi_read | 44.5 | 41.9–47.3 | 1.0% |
| papi_flush | 456.8 | 423.8–515.4 | 9.9% |
| off_boundary | 1911.8 | 1823.9–2205.9 | 41.6% |

Host calls 930,195 (31.01 per row), 2 `__FlushElementTree`, start delay 18.8 ms. Wall 4054.5 ms control / 4096.4 ms counts / 4596.8 ms timed; overhead 1.01× counts, 1.134× timed.

FCP@30000 for `react`: **not measured** — the vendored ReactLynx bundle is a fixed black-box artifact, and a pre-populated first screen is a build-time define of the app source; rebuilding the reference would change the bundle hash the featured runs recorded.

FCP@30000 for `vue-vdom`: **not measured** — the vendored Vue vdom+IFR+ET bundle is a fixed black-box artifact; see the ReactLynx note.

### Octane internal control — first-screen path vs create path @30000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 3155.8 ms on the control pages; its direct pre-populated FCP@30000 is 4054.5 ms — an excess of **898.7 ms (28.5%)** for the same rendered result. The counts build agrees: 3272.6 ms composed against 4096.4 ms direct.

The first-screen path issues 31.01 host calls per row against the create path's 20, and flushes 2 times against 1. The excess is 329,999 calls, 11 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 210,042 | 0 | +210,042 |
| `__SetAttribute` | 120,028 | 0 | +120,028 |
| `__AppendElement` | 210,041 | 210,000 | +41 |
| `__SetClasses` | 120,028 | 120,000 | +28 |
| `__CreateView` | 30,015 | 30,000 | +15 |
| `__CreateRawText` | 90,013 | 90,000 | +13 |
| `__CreateText` | 90,013 | 90,000 | +13 |
| `__AddEvent` | 60,012 | 60,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 20.1 | 429 | -408.9 |
| papi_create | 1729.1 | 1590.3 | +138.8 |
| papi_props | 287.3 | 195.5 | +91.8 |
| papi_events | 97.8 | 87.7 | +10.1 |
| papi_topology | 162.2 | 466.5 | -304.3 |
| papi_read | 44.5 | 0 | +44.5 |
| papi_flush | 456.8 | 0 | +456.8 |
| off_boundary | 1911.8 | 691.1 | +1220.7 |

### Octane − `react`, create@30000

Certified wall-clock delta: 139.8 ms on the control pages, 214.8 ms on the counts build. The attribution below runs on the timed build, whose delta is 159.5 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -106 | -66.5% | NO-GO | 600001 vs 630001 host calls at 0.0035 ms/op (reference rate) |
| Flush cadence | -0.1 | -0.1% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -96.4 | -60.4% | NO-GO | 429.0 vs 525.4 ms to the first host call |
| Per-element creation stream shape | 220.2 | 138.1% | GO | 0.0039 vs 0.0035 ms of host time per call |
| Framework script and browser paint outside the host boundary | 112.3 | 70.4% | GO | 691.1 vs 578.8 ms off the host boundary |
| **median non-additivity** | 29.5 | 18.5% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react`, startup

Certified wall-clock delta: 13.4 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 2.1 | 12.9% | GO | 195 vs 114 host calls at 0.0254 ms/op (reference rate) |
| Flush cadence | -0.1 | -0.6% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 12.2 | 76.2% | GO | 19.0 vs 6.8 ms to the first host call |
| Per-element creation stream shape | -2.4 | -14.8% | NO-GO | 0.0133 vs 0.0254 ms of host time per call |
| Framework script and browser paint outside the host boundary | 7.6 | 47.5% | GO | 11.5 vs 3.9 ms off the host boundary |
| **median non-additivity** | -3.4 | 21.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, create@30000

Certified wall-clock delta: -796.7 ms on the control pages, -511.3 ms on the counts build. The attribution below runs on the timed build, whose delta is -646.6 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -530.9 | n/a | NO-GO | 600001 vs 750001 host calls at 0.0035 ms/op (reference rate) |
| Flush cadence | -0.1 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -367.4 | n/a | NO-GO | 429.0 vs 796.4 ms to the first host call |
| Per-element creation stream shape | 216.2 | n/a | NO-GO | 0.0039 vs 0.0035 ms of host time per call |
| Framework script and browser paint outside the host boundary | -47.8 | n/a | NO-GO | 691.1 vs 738.9 ms off the host boundary |
| **median non-additivity** | 83.4 | 12.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `vue-vdom`, startup

Certified wall-clock delta: -3 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1 | 10.4% | GO | 195 vs 144 host calls at 0.0188 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 4.2 | 45.6% | GO | 19.0 vs 14.8 ms to the first host call |
| Per-element creation stream shape | -1.1 | -11.5% | NO-GO | 0.0133 vs 0.0188 ms of host time per call |
| Framework script and browser paint outside the host boundary | 9.2 | 100.0% | GO | 11.5 vs 2.3 ms off the host boundary |
| **median non-additivity** | -4.1 | 44.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 30,000 projected | 1,000 direct | 10,000 direct | 30,000 direct |
|---|---:|---:|---:|---:|---:|---:|
| octane | 166.8 | 1133.1 | 3155.8 | 182.9 | 1337.3 | 4054.5 |
| react | 137.3 | 1043.1 | 3002.9 | not measured | not measured | not measured |
| vue-vdom | 170.3 | 1325.6 | 3943.8 | not measured | not measured | not measured |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | 30,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---:|---|
| octane | 20 | 20 | 20 | 0.0% | yes |
| react | 21 | 21 | 21 | 0.0% | yes |
| vue-vdom | 25 | 25 | 25 | 0.0% | yes |

