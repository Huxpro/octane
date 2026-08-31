# Element PAPI boundary decomposition — Octane vs Octane (profile build) vs react-first-screen

- measured: 2026-08-31T01:08:51.553Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v22; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 1.38/1.03/1.08 (1/5/15m), end 1.28/1.49/1.30
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

`off_boundary` is a remainder for every cell, and on a profile-built Octane cell it splits further. The framework publishes which first-screen phase is running — render, publish, capture, announce — and the probe attributes each host call to the phase that issued it, so a phase's own off-boundary time is its wall span minus the host time observed inside it. What no phase claims is the residue: web-core's own script between host calls, plus the browser's style, layout, paint, and observer frame. The dependency runs one way — the framework publishes a marker and never reads the probe — and `render` crosses the boundary not at all, so its whole span is framework script by construction rather than by subtraction. The marker is compiled out of a shipping bundle, so the split is measured on a separate profile-built cell and no ratio is ever taken across the two builds.

The residue is an upper bound on the platform's share rather than a measurement of it, though a tight one. Framework script before the first host call is `start_delay`, a separate term of the identity, so the bundle's own evaluation and most of the install are already excluded. What can still land in the residue is framework script inside the window but outside the four phases: whatever the entry does after the first screen returns, and any install work that follows the first host call. That is the flattering direction for Octane and the conservative one for a floor claim — a control built against this residue must beat a number that may still hold a little framework cost the split did not measure.

Host call counts, flush cadence, and start delay are read from the counts build, whose wall clock carries no per-call clock reads. The timed build supplies host self time. Both builds count identically by construction, and the agreement is reported per cell as the control on the timed build's cost.

Two window predicates differ and the difference is not corrected away: the create window resolves on a shallow scan of the row container, while the FCP window resolves on the composed-tree content count `stages/run.mjs` already uses. The FCP predicate is the more expensive walk, so an FCP window carries up to one polling frame of that walk that a create window does not. Host call counts are exact and carry no such term.

## 1,000 rows

### Host call counts and flush cadence — create@1000

| host call | octane | octane-profile | react-first-screen |
|---|---:|---:|---:|
| `__AddEvent` | 2,000 | 2,000 | 2,000 |
| `__AppendElement` | 7,000 | 7,000 | 6,000 |
| `__CreateRawText` | 3,000 | 3,000 | 2,000 |
| `__CreateText` | 3,000 | 3,000 | 3,000 |
| `__CreateView` | 1,000 | 1,000 | 1,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetAttribute` | 0 | 0 | 3,000 |
| `__SetClasses` | 4,000 | 4,000 | 4,000 |
| **total host calls** | 20,001 | 20,001 | 21,001 |
| **host calls per row** | 20 | 20 | 21 |

| measure | octane | octane-profile | react-first-screen |
|---|---:|---:|---:|
| wall ms, control | 126.9 | 136.6 | 124.8 |
| wall ms, counts build | 133.9 | 135.4 | 130.6 |
| wall ms, timed build | 151.1 | 148.8 | 145 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 31.5 | 31 | 28.6 |
| host op time ms, timed | 91.6 | 85.7 | 89.5 |
| host ms per call, timed | 0.00458 | 0.00428 | 0.00426 |
| flush time ms, timed | 0 | 0 | 0.1 |
| off-boundary ms, timed | 29.3 | 31.5 | 25.8 |
| counts-build overhead | 1.055× | 0.991× | 1.046× |
| timed-build overhead | 1.191× | 1.089× | 1.162× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile | react-first-screen |
|---|---:|---:|---:|
| slice start → paint ms, control | 30 | 35 | 18.1 |
| slice start → paint ms, counts | 29.7 | 30.5 | 12.7 |
| start delay ms | 21.4 | 21.7 | 7.3 |
| host calls | 195 | 195 | 114 |
| `__FlushElementTree` calls | 2 | 2 | 1 |
| host op time ms, timed | 2.8 | 2.8 | 2.9 |
| off-boundary ms, timed | 6.7 | 3.9 | 1 |
| counts-build overhead | 0.99× | 0.871× | 0.702× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21.5 | 20.5–23 | 10.6% |
| papi_create | 57.2 | 52.5–74 | 28.3% |
| papi_props | 13.1 | 12.6–13.9 | 6.5% |
| papi_events | 6.7 | 6.3–8.8 | 3.3% |
| papi_topology | 7.7 | 7.5–9.3 | 3.8% |
| papi_read | 3 | 2.5–3.9 | 1.5% |
| papi_flush | 15.2 | 11.4–17.9 | 7.5% |
| off_boundary | 77.7 | 72–78.2 | 38.5% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 21.8 ms. Wall 174.9 ms control / 182.4 ms counts / 201.9 ms timed; overhead 1.043× counts, 1.154× timed.

### `octane-profile` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21.5 | 20.6–23.2 | 11.0% |
| papi_create | 63.2 | 55.3–67.3 | 32.2% |
| papi_props | 9.6 | 8.9–10.9 | 4.9% |
| papi_events | 6.4 | 6–6.8 | 3.3% |
| papi_topology | 5.9 | 4.9–6.8 | 3.0% |
| papi_read | 2.1 | 1.7–2.2 | 1.1% |
| papi_flush | 11.2 | 11.1–15.6 | 5.7% |
| off_boundary | 78.2 | 69.8–83 | 39.9% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 21.8 ms. Wall 183.6 ms control / 186.1 ms counts / 196.1 ms timed; overhead 1.014× counts, 1.068× timed.

### `react-first-screen` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 7.2 | 6.8–8.4 | 5.6% |
| papi_create | 49.5 | 47–54.7 | 38.4% |
| papi_props | 17.8 | 16.8–22 | 13.8% |
| papi_events | 5.9 | 5.4–6.6 | 4.6% |
| papi_topology | 4.6 | 3.9–6.3 | 3.6% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_other | 0.2 | 0.1–0.3 | 0.2% |
| papi_flush | 12.2 | 11.7–13.8 | 9.5% |
| off_boundary | 30.6 | 27.7–32 | 23.8% |

Host calls 21,114 (21.11 per row), 1 `__FlushElementTree`, start delay 7.8 ms. Wall 109.1 ms control / 118.3 ms counts / 128.8 ms timed; overhead 1.084× counts, 1.181× timed.

### `octane` first-screen phase split @1000 — what off-boundary time is Octane's

Measured on `octane-profile`, the profile build of `octane`. Its first-screen wall on the uninstrumented control pages is 183.6 ms against that shipping cell's 174.9 ms in the same window — +8.7 ms, +5.0%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 15.7 |
| publish | 24,152 | 95.6 | 44.9 |
| capture | 7,041 | 2 | 6.2 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 66.8 |
| **residue — web-core script and the browser frame** | — | — | 11.9 |

Off-boundary in the profiled cell's own timed FCP window is 78.2 ms, against 77.7 ms in `octane`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 156.9 ms on the control pages; its direct pre-populated FCP@1000 is 174.9 ms — an excess of **18 ms (11.5%)** for the same rendered result. The counts build agrees: 163.6 ms composed against 182.4 ms direct.

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
| start_delay | 21.5 | 31.5 | -10 |
| papi_create | 57.2 | 61.3 | -4.1 |
| papi_props | 13.1 | 7 | +6.1 |
| papi_events | 6.7 | 5.8 | +0.9 |
| papi_topology | 7.7 | 17.5 | -9.8 |
| papi_read | 3 | 0 | +3 |
| papi_flush | 15.2 | 0 | +15.2 |
| off_boundary | 77.7 | 29.3 | +48.4 |

### Octane − `react-first-screen`, create@1000

Certified wall-clock delta: 2.1 ms on the control pages, 3.3 ms on the counts build. The attribution below runs on the timed build, whose delta is 6.1 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -4.3 | -69.9% | NO-GO | 20001 vs 21001 host calls at 0.0043 ms/op (reference rate) |
| Flush cadence | -0.1 | -1.6% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 2 | 32.8% | GO | 31.5 vs 29.5 ms to the first host call |
| Per-element creation stream shape | 6.4 | 104.3% | GO | 0.0046 vs 0.0043 ms of host time per call |
| Framework script and browser paint outside the host boundary | 3.5 | 57.4% | GO | 29.3 vs 25.8 ms off the host boundary |
| **median non-additivity** | -1.4 | 22.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, startup

Certified wall-clock delta: 17 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 2.1 | 10.8% | GO | 195 vs 114 host calls at 0.0254 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.5% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 13.8 | 72.6% | GO | 21.5 vs 7.7 ms to the first host call |
| Per-element creation stream shape | -2.2 | -11.4% | NO-GO | 0.0144 vs 0.0254 ms of host time per call |
| Framework script and browser paint outside the host boundary | 5.7 | 30.0% | GO | 6.7 vs 1.0 ms off the host boundary |
| **median non-additivity** | -0.5 | 2.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, FCP@1000

Certified wall-clock delta: 65.8 ms on the control pages, 64.1 ms on the counts build. The attribution below runs on the timed build, whose delta is 73.1 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 37.2 | 50.9% | GO | 31195 vs 21114 host calls at 0.0037 ms/op (reference rate) |
| Flush cadence | 3 | 4.1% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 14.3 | 19.6% | GO | 21.5 vs 7.2 ms to the first host call |
| Per-element creation stream shape | -27.5 | -37.7% | NO-GO | 0.0028 vs 0.0037 ms of host time per call |
| Framework script and browser paint outside the host boundary | 47.1 | 64.4% | GO | 77.7 vs 30.6 ms off the host boundary |
| **median non-additivity** | -1 | 1.4% | — | the identity is exact per sample; each owner above is a median of its own sample |

## 10,000 rows

### Host call counts and flush cadence — create@10000

| host call | octane | octane-profile | react-first-screen |
|---|---:|---:|---:|
| `__AddEvent` | 20,000 | 20,000 | 20,000 |
| `__AppendElement` | 70,000 | 70,000 | 60,000 |
| `__CreateRawText` | 30,000 | 30,000 | 20,000 |
| `__CreateText` | 30,000 | 30,000 | 30,000 |
| `__CreateView` | 10,000 | 10,000 | 10,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetAttribute` | 0 | 0 | 30,000 |
| `__SetClasses` | 40,000 | 40,000 | 40,000 |
| **total host calls** | 200,001 | 200,001 | 210,001 |
| **host calls per row** | 20 | 20 | 21 |

| measure | octane | octane-profile | react-first-screen |
|---|---:|---:|---:|
| wall ms, control | 1086.2 | 1117.7 | 1050.9 |
| wall ms, counts build | 1121.4 | 1140.6 | 1129.3 |
| wall ms, timed build | 1259.7 | 1234 | 1229.4 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 162 | 150.2 | 205.2 |
| host op time ms, timed | 831.6 | 789.4 | 813.5 |
| host ms per call, timed | 0.00416 | 0.00395 | 0.00387 |
| flush time ms, timed | 0.1 | 0.1 | 0 |
| off-boundary ms, timed | 266.5 | 283.9 | 194.8 |
| counts-build overhead | 1.032× | 1.02× | 1.075× |
| timed-build overhead | 1.16× | 1.104× | 1.17× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile | react-first-screen |
|---|---:|---:|---:|
| slice start → paint ms, control | 33.6 | 31.1 | 11 |
| slice start → paint ms, counts | 34.5 | 28.8 | 15.4 |
| start delay ms | 22.1 | 21.4 | 7 |
| host calls | 195 | 195 | 114 |
| `__FlushElementTree` calls | 2 | 2 | 1 |
| host op time ms, timed | 3 | 2.9 | 2.6 |
| off-boundary ms, timed | 7.2 | 7.8 | 1.4 |
| counts-build overhead | 1.027× | 0.926× | 1.4× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.9 | 20.5–21.6 | 1.4% |
| papi_create | 557.3 | 507.8–581.6 | 36.8% |
| papi_props | 107 | 102.5–114.1 | 7.1% |
| papi_events | 38.5 | 37.9–41.3 | 2.5% |
| papi_topology | 72 | 69.3–72.9 | 4.8% |
| papi_read | 27.4 | 25.7–30.1 | 1.8% |
| papi_flush | 141.7 | 137.2–148.7 | 9.4% |
| off_boundary | 558.5 | 544.1–585.1 | 36.9% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 20.3 ms. Wall 1280.8 ms control / 1329.1 ms counts / 1515.3 ms timed; overhead 1.038× counts, 1.183× timed.

### `octane-profile` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 22 | 21.3–24.2 | 1.5% |
| papi_create | 529.4 | 508.7–573.5 | 35.3% |
| papi_props | 95.8 | 88.9–109.6 | 6.4% |
| papi_events | 35.5 | 35.2–39 | 2.4% |
| papi_topology | 58.5 | 56.3–64.4 | 3.9% |
| papi_read | 16.3 | 15.2–19.3 | 1.1% |
| papi_flush | 139.8 | 138.9–150.5 | 9.3% |
| off_boundary | 599.9 | 578.7–635.1 | 40.0% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 21.2 ms. Wall 1288.4 ms control / 1340.6 ms counts / 1498.8 ms timed; overhead 1.041× counts, 1.163× timed.

### `react-first-screen` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 11.1 | 10.6–11.4 | 1.0% |
| papi_create | 439.8 | 414.2–445.8 | 41.6% |
| papi_props | 152.2 | 140.4–159.4 | 14.4% |
| papi_events | 28.9 | 26.8–33.2 | 2.7% |
| papi_topology | 46 | 44.6–52.7 | 4.3% |
| papi_read | 0 | 0–0 | 0.0% |
| papi_other | 1.1 | 1–1.2 | 0.1% |
| papi_flush | 159.6 | 155.6–176.4 | 15.1% |
| off_boundary | 223.3 | 210.5–250.4 | 21.1% |

Host calls 210,114 (21.01 per row), 1 `__FlushElementTree`, start delay 11 ms. Wall 866.3 ms control / 947.2 ms counts / 1058.2 ms timed; overhead 1.093× counts, 1.222× timed.

### `octane` first-screen phase split @10000 — what off-boundary time is Octane's

Measured on `octane-profile`, the profile build of `octane`. Its first-screen wall on the uninstrumented control pages is 1288.4 ms against that shipping cell's 1280.8 ms in the same window — +7.6 ms, +0.6%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 91.8 |
| publish | 240,152 | 856.1 | 362.1 |
| capture | 70,041 | 16.2 | 53.3 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 505 |
| **residue — web-core script and the browser frame** | — | — | 94.9 |

Off-boundary in the profiled cell's own timed FCP window is 599.9 ms, against 558.5 ms in `octane`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1119.8 ms on the control pages; its direct pre-populated FCP@10000 is 1280.8 ms — an excess of **161 ms (14.4%)** for the same rendered result. The counts build agrees: 1155.9 ms composed against 1329.1 ms direct.

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
| start_delay | 20.9 | 162.9 | -142 |
| papi_create | 557.3 | 552.5 | +4.8 |
| papi_props | 107 | 64 | +43 |
| papi_events | 38.5 | 36.1 | +2.4 |
| papi_topology | 72 | 179 | -107 |
| papi_read | 27.4 | 0 | +27.4 |
| papi_flush | 141.7 | 0.1 | +141.6 |
| off_boundary | 558.5 | 266.5 | +292 |

### Octane − `react-first-screen`, create@10000

Certified wall-clock delta: 35.3 ms on the control pages, -7.9 ms on the counts build. The attribution below runs on the timed build, whose delta is 30.3 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -38.7 | -127.8% | NO-GO | 200001 vs 210001 host calls at 0.0039 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.3% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -41.7 | -137.6% | NO-GO | 162.9 vs 204.6 ms to the first host call |
| Per-element creation stream shape | 56.8 | 187.6% | GO | 0.0042 vs 0.0039 ms of host time per call |
| Framework script and browser paint outside the host boundary | 71.7 | 236.6% | GO | 266.5 vs 194.8 ms off the host boundary |
| **median non-additivity** | -17.9 | 59.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, startup

Certified wall-clock delta: 19.1 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.8 | 10.1% | GO | 195 vs 114 host calls at 0.0228 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.5% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 15.6 | 85.2% | GO | 22.2 vs 6.6 ms to the first host call |
| Per-element creation stream shape | -1.4 | -7.9% | NO-GO | 0.0154 vs 0.0228 ms of host time per call |
| Framework script and browser paint outside the host boundary | 5.8 | 31.7% | GO | 7.2 vs 1.4 ms off the host boundary |
| **median non-additivity** | -3.6 | 19.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, FCP@10000

Certified wall-clock delta: 414.5 ms on the control pages, 381.9 ms on the counts build. The attribution below runs on the timed build, whose delta is 457.1 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 318.2 | 69.6% | GO | 310195 vs 210114 host calls at 0.0032 ms/op (reference rate) |
| Flush cadence | -17.9 | -3.9% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 9.8 | 2.1% | NO-GO | 20.9 vs 11.1 ms to the first host call |
| Per-element creation stream shape | -184 | -40.2% | NO-GO | 0.0026 vs 0.0032 ms of host time per call |
| Framework script and browser paint outside the host boundary | 335.2 | 73.3% | GO | 558.5 vs 223.3 ms off the host boundary |
| **median non-additivity** | -4.2 | 0.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 1,000 direct | 10,000 direct |
|---|---:|---:|---:|---:|
| octane | 156.9 | 1119.8 | 174.9 | 1280.8 |
| octane-profile | 171.6 | 1148.8 | 183.6 | 1288.4 |
| react-first-screen | 142.9 | 1061.9 | 109.1 | 866.3 |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---|
| octane | 20 | 20 | 0.0% | yes |
| octane-profile | 20 | 20 | 0.0% | yes |
| react-first-screen | 21 | 21 | 0.0% | yes |

