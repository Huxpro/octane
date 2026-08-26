# Element PAPI boundary decomposition — Octane vs Octane (profile build) vs Octane (main-thread program) vs Octane (main-thread program, profile build) vs L0 direct-emission prototype

- measured: 2026-08-26T05:41:30.606Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 2.97/1.40/1.26 (1/5/15m), end 1.52/1.44/1.50
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

| host call | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| `__AddEvent` | 2,000 | 2,000 | 2,000 | 2,000 | 2,000 |
| `__AppendElement` | 7,000 | 7,000 | 7,000 | 7,000 | 7,000 |
| `__CreateRawText` | 3,000 | 3,000 | 3,000 | 3,000 | 3,000 |
| `__CreateText` | 3,000 | 3,000 | 3,000 | 3,000 | 3,000 |
| `__CreateView` | 1,000 | 1,000 | 1,000 | 1,000 | 1,000 |
| `__FlushElementTree` | 1 | 1 | 1 | 1 | 1 |
| `__SetClasses` | 4,000 | 4,000 | 4,000 | 4,000 | 4,000 |
| **total host calls** | 20,001 | 20,001 | 20,001 | 20,001 | 20,001 |
| **host calls per row** | 20 | 20 | 20 | 20 | 20 |

| measure | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| wall ms, control | 142.8 | 150.5 | 143.3 | 156.4 | 100.7 |
| wall ms, counts build | 153.1 | 157.9 | 150.2 | 153.3 | 114.1 |
| wall ms, timed build | 166.5 | 170.3 | 167.5 | 168.4 | 120.5 |
| `__FlushElementTree` calls | 1 | 1 | 1 | 1 | 1 |
| start delay ms | 35.1 | 35.4 | 38 | 36.8 | 3.7 |
| host op time ms, timed | 97 | 94 | 96.1 | 94.6 | 96.1 |
| host ms per call, timed | 0.00485 | 0.0047 | 0.0048 | 0.00473 | 0.0048 |
| flush time ms, timed | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| off-boundary ms, timed | 33.5 | 38.6 | 33.7 | 39.5 | 20.3 |
| counts-build overhead | 1.072× | 1.049× | 1.048× | 0.98× | 1.133× |
| timed-build overhead | 1.166× | 1.132× | 1.169× | 1.077× | 1.197× |
| counts agree across builds | yes | yes | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| slice start → paint ms, control | 32.4 | 30.4 | 31.2 | 30.6 | 13.4 |
| slice start → paint ms, counts | 29.6 | 30.4 | 27.3 | 30.5 | 10.2 |
| start delay ms | 21.5 | 21.2 | 20.2 | 21.9 | 3.5 |
| host calls | 195 | 195 | 126 | 126 | 127 |
| `__FlushElementTree` calls | 2 | 2 | 2 | 2 | 2 |
| host op time ms, timed | 3.2 | 3.3 | 3.1 | 2.9 | 3.2 |
| off-boundary ms, timed | 3.6 | 3.7 | 2.4 | 2.7 | 1.5 |
| counts-build overhead | 0.914× | 1× | 0.875× | 0.997× | 0.761× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21.4 | 20.2–22.9 | 9.9% |
| papi_create | 65.9 | 63.1–81.1 | 30.5% |
| papi_props | 12.4 | 11.8–15.7 | 5.7% |
| papi_events | 7.7 | 6.3–11.2 | 3.6% |
| papi_topology | 7.8 | 6.4–8.3 | 3.6% |
| papi_read | 2.5 | 2.3–3.2 | 1.2% |
| papi_flush | 22.5 | 20.6–24 | 10.4% |
| off_boundary | 77.4 | 73.9–99.7 | 35.8% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 20.3 ms. Wall 189.9 ms control / 201.3 ms counts / 216.3 ms timed; overhead 1.06× counts, 1.139× timed.

### `octane-profile` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21.6 | 19.8–24.2 | 9.7% |
| papi_create | 63.9 | 58.2–70.3 | 28.6% |
| papi_props | 11.5 | 9.6–16.5 | 5.1% |
| papi_events | 7.8 | 6.6–8.6 | 3.5% |
| papi_topology | 6.3 | 5.9–7.4 | 2.8% |
| papi_read | 2.2 | 1.8–2.4 | 1.0% |
| papi_flush | 21.4 | 21.2–23.7 | 9.6% |
| off_boundary | 87.6 | 82.1–91.9 | 39.1% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 20.8 ms. Wall 198.1 ms control / 206.4 ms counts / 223.8 ms timed; overhead 1.042× counts, 1.13× timed.

### `octane-mts-program` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.3 | 19.3–22.7 | 12.5% |
| papi_create | 60.7 | 56.4–65.1 | 37.3% |
| papi_props | 7.3 | 7.2–11.1 | 4.5% |
| papi_events | 6.6 | 6.5–6.8 | 4.1% |
| papi_topology | 7 | 6.6–8.3 | 4.3% |
| papi_read | 0.1 | 0–0.1 | 0.1% |
| papi_flush | 16.6 | 15.8–18.2 | 10.2% |
| off_boundary | 44.3 | 43.7–48.5 | 27.2% |

Host calls 20,126 (20.13 per row), 2 `__FlushElementTree`, start delay 21.8 ms. Wall 149.6 ms control / 159 ms counts / 162.9 ms timed; overhead 1.063× counts, 1.089× timed.

### `octane-mts-program-profile` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 22.4 | 21.1–26.3 | 12.6% |
| papi_create | 61.1 | 57.5–68 | 34.4% |
| papi_props | 8.5 | 6.7–10.5 | 4.8% |
| papi_events | 6.8 | 6.4–9.1 | 3.8% |
| papi_topology | 5.2 | 4–7.4 | 2.9% |
| papi_read | 0.1 | 0–0.1 | 0.1% |
| papi_flush | 18.7 | 16.3–21.6 | 10.5% |
| off_boundary | 52.2 | 47.9–57.6 | 29.4% |

Host calls 20,126 (20.13 per row), 2 `__FlushElementTree`, start delay 21.5 ms. Wall 159.4 ms control / 165.7 ms counts / 177.5 ms timed; overhead 1.04× counts, 1.114× timed.

### `octane-direct` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 3.5 | 3.1–3.6 | 3.0% |
| papi_create | 58.1 | 55.5–63.2 | 49.3% |
| papi_props | 8.1 | 6.6–13.4 | 6.9% |
| papi_events | 5.7 | 5.1–6.7 | 4.8% |
| papi_topology | 5.1 | 4.5–6.5 | 4.3% |
| papi_read | 0 | 0–0 | 0.0% |
| papi_flush | 19.5 | 17.9–21.6 | 16.5% |
| off_boundary | 19.2 | 17–19.7 | 16.3% |

Host calls 20,127 (20.13 per row), 2 `__FlushElementTree`, start delay 3.2 ms. Wall 106.1 ms control / 107.3 ms counts / 117.9 ms timed; overhead 1.011× counts, 1.111× timed.

### `octane` first-screen phase split @1000 — what off-boundary time is Octane's

Measured on `octane-profile`, the profile build of `octane`. Its first-screen wall on the uninstrumented control pages is 198.1 ms against that shipping cell's 189.9 ms in the same window — +8.2 ms, +4.3%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 15.8 |
| publish | 24,152 | 109.6 | 48.5 |
| capture | 7,041 | 2.2 | 6.6 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 72.9 |
| **residue — web-core script and the browser frame** | — | — | 14.7 |

Off-boundary in the profiled cell's own timed FCP window is 87.6 ms, against 77.4 ms in `octane`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### `octane-mts-program` first-screen phase split @1000 — what off-boundary time is Octane's

Measured on `octane-mts-program-profile`, the profile build of `octane-mts-program`. Its first-screen wall on the uninstrumented control pages is 159.4 ms against that shipping cell's 149.6 ms in the same window — +9.8 ms, +6.6%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 9.2 |
| publish | 20,124 | 98.4 | 25.1 |
| capture | 0 | 0 | 0.8 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 35.3 |
| **residue — web-core script and the browser frame** | — | — | 17.5 |

Off-boundary in the profiled cell's own timed FCP window is 52.2 ms, against 44.3 ms in `octane-mts-program`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 175.2 ms on the control pages; its direct pre-populated FCP@1000 is 189.9 ms — an excess of **14.7 ms (8.4%)** for the same rendered result. The counts build agrees: 182.7 ms composed against 201.3 ms direct.

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
| start_delay | 21.4 | 34.9 | -13.5 |
| papi_create | 65.9 | 62.8 | +3.1 |
| papi_props | 12.4 | 8.4 | +4 |
| papi_events | 7.7 | 6 | +1.7 |
| papi_topology | 7.8 | 19.8 | -12 |
| papi_read | 2.5 | 0 | +2.5 |
| papi_flush | 22.5 | 0.1 | +22.4 |
| off_boundary | 77.4 | 33.5 | +43.9 |

### Octane − `octane-mts-program`, create@1000

Certified wall-clock delta: -0.5 ms on the control pages, 2.9 ms on the counts build. The attribution below runs on the timed build, whose delta is -1 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | n/a | NO-GO | 20001 vs 20001 host calls at 0.0048 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -1 | n/a | NO-GO | 34.9 vs 35.9 ms to the first host call |
| Per-element creation stream shape | 0.9 | n/a | NO-GO | 0.0048 vs 0.0048 ms of host time per call |
| Framework script and browser paint outside the host boundary | -0.2 | n/a | NO-GO | 33.5 vs 33.7 ms off the host boundary |
| **median non-additivity** | -0.7 | 70.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: 2.3 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.7 | 70.7% | GO | 195 vs 126 host calls at 0.0246 ms/op (reference rate) |
| Flush cadence | -0.1 | -4.2% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -0.4 | -16.7% | NO-GO | 20.3 vs 20.7 ms to the first host call |
| Per-element creation stream shape | -1.6 | -66.6% | NO-GO | 0.0164 vs 0.0246 ms of host time per call |
| Framework script and browser paint outside the host boundary | 1.2 | 50.0% | GO | 3.6 vs 2.4 ms off the host boundary |
| **median non-additivity** | 1.6 | 66.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, create@1000

Certified wall-clock delta: 42.1 ms on the control pages, 39 ms on the counts build. The attribution below runs on the timed build, whose delta is 46 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 20001 vs 20001 host calls at 0.0048 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 31.4 | 68.3% | GO | 34.9 vs 3.5 ms to the first host call |
| Per-element creation stream shape | 0.9 | 2.0% | NO-GO | 0.0048 vs 0.0048 ms of host time per call |
| Framework script and browser paint outside the host boundary | 13.2 | 28.7% | GO | 33.5 vs 20.3 ms off the host boundary |
| **median non-additivity** | 0.5 | 1.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, startup

Certified wall-clock delta: 19.4 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.7 | 8.9% | NO-GO | 195 vs 127 host calls at 0.0252 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 16.6 | 86.5% | GO | 20.3 vs 3.7 ms to the first host call |
| Per-element creation stream shape | -1.7 | -8.9% | NO-GO | 0.0164 vs 0.0252 ms of host time per call |
| Framework script and browser paint outside the host boundary | 2.1 | 10.9% | GO | 3.6 vs 1.5 ms off the host boundary |
| **median non-additivity** | 0.5 | 2.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

## 10,000 rows

### Host call counts and flush cadence — create@10000

| host call | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| `__AddEvent` | 20,000 | 20,000 | 20,000 | 20,000 | 20,000 |
| `__AppendElement` | 70,000 | 70,000 | 70,000 | 70,000 | 70,000 |
| `__CreateRawText` | 30,000 | 30,000 | 30,000 | 30,000 | 30,000 |
| `__CreateText` | 30,000 | 30,000 | 30,000 | 30,000 | 30,000 |
| `__CreateView` | 10,000 | 10,000 | 10,000 | 10,000 | 10,000 |
| `__FlushElementTree` | 1 | 1 | 1 | 1 | 1 |
| `__SetClasses` | 40,000 | 40,000 | 40,000 | 40,000 | 40,000 |
| **total host calls** | 200,001 | 200,001 | 200,001 | 200,001 | 200,001 |
| **host calls per row** | 20 | 20 | 20 | 20 | 20 |

| measure | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| wall ms, control | 1291.4 | 1328.2 | 1311.7 | 1353.2 | 988.1 |
| wall ms, counts build | 1361.8 | 1345.7 | 1419.2 | 1407.6 | 1007.7 |
| wall ms, timed build | 1472.5 | 1459 | 1544.7 | 1552.2 | 1175.9 |
| `__FlushElementTree` calls | 1 | 1 | 1 | 1 | 1 |
| start delay ms | 188.8 | 196.1 | 195 | 202.1 | 10 |
| host op time ms, timed | 964.9 | 922.5 | 999.6 | 973.7 | 964.8 |
| host ms per call, timed | 0.00482 | 0.00461 | 0.005 | 0.00487 | 0.00482 |
| flush time ms, timed | 0.1 | 0.1 | 0.1 | 0.2 | 0.1 |
| off-boundary ms, timed | 303.1 | 311.7 | 313.4 | 378.2 | 212.4 |
| counts-build overhead | 1.055× | 1.013× | 1.082× | 1.04× | 1.02× |
| timed-build overhead | 1.14× | 1.098× | 1.178× | 1.147× | 1.19× |
| counts agree across builds | yes | yes | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| slice start → paint ms, control | 35.2 | 34.2 | 33 | 31.6 | 10.1 |
| slice start → paint ms, counts | 34.7 | 35.5 | 33.1 | 29 | 9 |
| start delay ms | 22.4 | 20.4 | 23.2 | 21.7 | 3.3 |
| host calls | 195 | 195 | 126 | 126 | 127 |
| `__FlushElementTree` calls | 2 | 2 | 2 | 2 | 2 |
| host op time ms, timed | 3.8 | 3.2 | 2.9 | 3.3 | 3.7 |
| off-boundary ms, timed | 4.2 | 4.2 | 7.1 | 3.6 | 1.3 |
| counts-build overhead | 0.986× | 1.038× | 1.003× | 0.918× | 0.891× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21 | 19.9–23.6 | 1.2% |
| papi_create | 610.2 | 580.5–646.5 | 34.0% |
| papi_props | 120.9 | 108.7–152.2 | 6.7% |
| papi_events | 43 | 39.9–46.1 | 2.4% |
| papi_topology | 73.1 | 66.7–76 | 4.1% |
| papi_read | 25.2 | 24.9–28.3 | 1.4% |
| papi_flush | 200.2 | 183.1–213.9 | 11.2% |
| off_boundary | 677.5 | 653.3–721.3 | 37.8% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 21.2 ms. Wall 1582 ms control / 1599.2 ms counts / 1792.4 ms timed; overhead 1.011× counts, 1.133× timed.

### `octane-profile` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 22.8 | 21–26.1 | 1.3% |
| papi_create | 578.2 | 567.1–623 | 32.1% |
| papi_props | 107.9 | 99.9–148.4 | 6.0% |
| papi_events | 39.8 | 37.4–44.1 | 2.2% |
| papi_topology | 59.4 | 56.8–63.2 | 3.3% |
| papi_read | 17.3 | 15.3–21.1 | 1.0% |
| papi_flush | 202.5 | 194.3–207.1 | 11.3% |
| off_boundary | 751.3 | 724.1–782.9 | 41.7% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 20.3 ms. Wall 1589.3 ms control / 1664.8 ms counts / 1799.6 ms timed; overhead 1.048× counts, 1.132× timed.

### `octane-mts-program` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 22.1 | 20.8–23.7 | 1.6% |
| papi_create | 625.3 | 593.2–643.8 | 44.2% |
| papi_props | 68.8 | 67.1–73.7 | 4.9% |
| papi_events | 40.7 | 34.7–45.2 | 2.9% |
| papi_topology | 64.4 | 60.2–72.4 | 4.6% |
| papi_read | 0.1 | 0–0.2 | 0.0% |
| papi_flush | 230.4 | 223.1–259.3 | 16.3% |
| off_boundary | 360.4 | 333.2–391.5 | 25.5% |

Host calls 200,126 (20.01 per row), 2 `__FlushElementTree`, start delay 23.2 ms. Wall 1175.1 ms control / 1324.5 ms counts / 1414.8 ms timed; overhead 1.127× counts, 1.204× timed.

### `octane-mts-program-profile` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 24 | 20.8–25 | 1.7% |
| papi_create | 605.8 | 528.6–622.3 | 43.9% |
| papi_props | 62.1 | 58.6–71.1 | 4.5% |
| papi_events | 40.5 | 33.4–42.5 | 2.9% |
| papi_topology | 54.4 | 47.9–57.5 | 3.9% |
| papi_read | 0.1 | 0–0.5 | 0.0% |
| papi_flush | 227.3 | 213.7–265.5 | 16.5% |
| off_boundary | 403.5 | 378.1–445.1 | 29.2% |

Host calls 200,126 (20.01 per row), 2 `__FlushElementTree`, start delay 21.5 ms. Wall 1304.9 ms control / 1250.8 ms counts / 1379.6 ms timed; overhead 0.959× counts, 1.057× timed.

### `octane-direct` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 3.3 | 3.2–4 | 0.3% |
| papi_create | 569.8 | 561.7–604.3 | 50.0% |
| papi_props | 70.8 | 60.6–74 | 6.2% |
| papi_events | 33.6 | 29.4–36.7 | 2.9% |
| papi_topology | 51.9 | 50.1–55.1 | 4.6% |
| papi_read | 0 | 0–0 | 0.0% |
| papi_flush | 191.6 | 184.3–203.8 | 16.8% |
| off_boundary | 209.9 | 193.2–238 | 18.4% |

Host calls 200,127 (20.01 per row), 2 `__FlushElementTree`, start delay 3.2 ms. Wall 999.6 ms control / 1037.9 ms counts / 1140 ms timed; overhead 1.038× counts, 1.14× timed.

### `octane` first-screen phase split @10000 — what off-boundary time is Octane's

Measured on `octane-profile`, the profile build of `octane`. Its first-screen wall on the uninstrumented control pages is 1589.3 ms against that shipping cell's 1582 ms in the same window — +7.3 ms, +0.5%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 89 |
| publish | 240,152 | 987.1 | 464.8 |
| capture | 70,041 | 17.2 | 65.2 |
| announce | 0 | 0 | 0.1 |
| **Octane first-screen script** | — | — | 626.1 |
| **residue — web-core script and the browser frame** | — | — | 124.5 |

Off-boundary in the profiled cell's own timed FCP window is 751.3 ms, against 677.5 ms in `octane`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### `octane-mts-program` first-screen phase split @10000 — what off-boundary time is Octane's

Measured on `octane-mts-program-profile`, the profile build of `octane-mts-program`. Its first-screen wall on the uninstrumented control pages is 1304.9 ms against that shipping cell's 1175.1 ms in the same window — +129.8 ms, +11.0%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 43.9 |
| publish | 200,124 | 977 | 240.4 |
| capture | 0 | 0 | 6.8 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 292.5 |
| **residue — web-core script and the browser frame** | — | — | 119.1 |

Off-boundary in the profiled cell's own timed FCP window is 403.5 ms, against 360.4 ms in `octane-mts-program`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1326.6 ms on the control pages; its direct pre-populated FCP@10000 is 1582 ms — an excess of **255.4 ms (19.3%)** for the same rendered result. The counts build agrees: 1396.5 ms composed against 1599.2 ms direct.

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
| start_delay | 21 | 187.5 | -166.5 |
| papi_create | 610.2 | 653.4 | -43.2 |
| papi_props | 120.9 | 79.5 | +41.4 |
| papi_events | 43 | 40.5 | +2.5 |
| papi_topology | 73.1 | 191.5 | -118.4 |
| papi_read | 25.2 | 0 | +25.2 |
| papi_flush | 200.2 | 0.1 | +200.1 |
| off_boundary | 677.5 | 303.1 | +374.4 |

### Octane − `octane-mts-program`, create@10000

Certified wall-clock delta: -20.3 ms on the control pages, -57.4 ms on the counts build. The attribution below runs on the timed build, whose delta is -72.2 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | n/a | NO-GO | 200001 vs 200001 host calls at 0.0050 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -9.3 | n/a | NO-GO | 187.5 vs 196.8 ms to the first host call |
| Per-element creation stream shape | -34.7 | n/a | NO-GO | 0.0048 vs 0.0050 ms of host time per call |
| Framework script and browser paint outside the host boundary | -10.3 | n/a | NO-GO | 303.1 vs 313.4 ms off the host boundary |
| **median non-additivity** | -17.9 | 24.8% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: 1.6 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.6 | n/a | NO-GO | 195 vs 126 host calls at 0.0230 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -2.2 | n/a | NO-GO | 21.1 vs 23.3 ms to the first host call |
| Per-element creation stream shape | -0.7 | n/a | NO-GO | 0.0195 vs 0.0230 ms of host time per call |
| Framework script and browser paint outside the host boundary | -2.9 | n/a | NO-GO | 4.2 vs 7.1 ms off the host boundary |
| **median non-additivity** | 1.5 | 55.5% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, create@10000

Certified wall-clock delta: 303.3 ms on the control pages, 354.1 ms on the counts build. The attribution below runs on the timed build, whose delta is 296.6 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 200001 vs 200001 host calls at 0.0048 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 176.6 | 59.5% | GO | 187.5 vs 10.9 ms to the first host call |
| Per-element creation stream shape | 0.1 | 0.0% | NO-GO | 0.0048 vs 0.0048 ms of host time per call |
| Framework script and browser paint outside the host boundary | 90.7 | 30.6% | GO | 303.1 vs 212.4 ms off the host boundary |
| **median non-additivity** | 29.2 | 9.8% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, startup

Certified wall-clock delta: 25.7 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 2 | 9.4% | NO-GO | 195 vs 127 host calls at 0.0291 ms/op (reference rate) |
| Flush cadence | -0.2 | -1.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 17.4 | 82.9% | GO | 21.1 vs 3.7 ms to the first host call |
| Per-element creation stream shape | -1.9 | -9.0% | NO-GO | 0.0195 vs 0.0291 ms of host time per call |
| Framework script and browser paint outside the host boundary | 2.9 | 13.8% | GO | 4.2 vs 1.3 ms off the host boundary |
| **median non-additivity** | 0.8 | 3.8% | — | the identity is exact per sample; each owner above is a median of its own sample |

## 30,000 rows

### Host call counts and flush cadence — create@30000

| host call | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| `__AddEvent` | 60,000 | 60,000 | 60,000 | 60,000 | 60,000 |
| `__AppendElement` | 210,000 | 210,000 | 210,000 | 210,000 | 210,000 |
| `__CreateRawText` | 90,000 | 90,000 | 90,000 | 90,000 | 90,000 |
| `__CreateText` | 90,000 | 90,000 | 90,000 | 90,000 | 90,000 |
| `__CreateView` | 30,000 | 30,000 | 30,000 | 30,000 | 30,000 |
| `__FlushElementTree` | 1 | 1 | 1 | 1 | 1 |
| `__SetClasses` | 120,000 | 120,000 | 120,000 | 120,000 | 120,000 |
| **total host calls** | 600,001 | 600,001 | 600,001 | 600,001 | 600,001 |
| **host calls per row** | 20 | 20 | 20 | 20 | 20 |

| measure | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| wall ms, control | 3624.2 | 3941.2 | 3535.3 | 3873 | 2807.1 |
| wall ms, counts build | 3702.2 | 3846.9 | 3726.5 | 3925.3 | 2796.5 |
| wall ms, timed build | 4196.7 | 4496.3 | 4237 | 4200.5 | 3253.6 |
| `__FlushElementTree` calls | 1 | 1 | 1 | 1 | 1 |
| start delay ms | 471.4 | 472.2 | 456.6 | 491.2 | 20.3 |
| host op time ms, timed | 2852.3 | 3044.9 | 2883.4 | 2671.3 | 2766.4 |
| host ms per call, timed | 0.00475 | 0.00507 | 0.00481 | 0.00445 | 0.00461 |
| flush time ms, timed | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| off-boundary ms, timed | 833.1 | 1023.7 | 868.7 | 1048.9 | 474.6 |
| counts-build overhead | 1.022× | 0.976× | 1.054× | 1.014× | 0.996× |
| timed-build overhead | 1.158× | 1.141× | 1.198× | 1.085× | 1.159× |
| counts agree across builds | yes | yes | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| slice start → paint ms, control | 29.6 | 31.7 | 26.8 | 29.1 | 12 |
| slice start → paint ms, counts | 31.9 | 33 | 35.3 | 31.8 | 13.1 |
| start delay ms | 20.8 | 22.2 | 23.3 | 24.5 | 3.2 |
| host calls | 195 | 195 | 126 | 126 | 127 |
| `__FlushElementTree` calls | 2 | 2 | 2 | 2 | 2 |
| host op time ms, timed | 3.6 | 3.2 | 2.9 | 3.2 | 3.7 |
| off-boundary ms, timed | 4.1 | 3.7 | 6.8 | 4 | 4 |
| counts-build overhead | 1.078× | 1.041× | 1.317× | 1.093× | 1.092× |

### `octane` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.9 | 20–25.3 | 0.4% |
| papi_create | 2122.9 | 1773.9–2142.6 | 38.5% |
| papi_props | 415.8 | 361.5–429.1 | 7.5% |
| papi_events | 121.2 | 111–124.5 | 2.2% |
| papi_topology | 217 | 207.8–226.6 | 3.9% |
| papi_read | 78.8 | 71.8–80.6 | 1.4% |
| papi_flush | 633.6 | 628.3–672.6 | 11.5% |
| off_boundary | 2012.2 | 1902.3–2173.4 | 36.5% |

Host calls 930,195 (31.01 per row), 2 `__FlushElementTree`, start delay 20.6 ms. Wall 4580.7 ms control / 4876.1 ms counts / 5519.9 ms timed; overhead 1.064× counts, 1.205× timed.

### `octane-profile` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 22.1 | 19.7–27.5 | 0.4% |
| papi_create | 1938.1 | 1821–2064.7 | 35.8% |
| papi_props | 339 | 321.7–515.2 | 6.3% |
| papi_events | 111.3 | 99.3–132.1 | 2.1% |
| papi_topology | 176.2 | 173–177.8 | 3.3% |
| papi_read | 47.8 | 47.1–55.8 | 0.9% |
| papi_flush | 618 | 556.7–658.4 | 11.4% |
| off_boundary | 2137.6 | 2048.8–2194.7 | 39.5% |

Host calls 930,195 (31.01 per row), 2 `__FlushElementTree`, start delay 21 ms. Wall 4738.8 ms control / 5072.9 ms counts / 5412.9 ms timed; overhead 1.071× counts, 1.142× timed.

### `octane-mts-program` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 22.5 | 20.7–33.8 | 0.5% |
| papi_create | 1789.6 | 1604.4–2039.6 | 42.3% |
| papi_props | 196.2 | 181.5–230.7 | 4.6% |
| papi_events | 109.7 | 101.3–132.5 | 2.6% |
| papi_topology | 191.4 | 175.5–210.5 | 4.5% |
| papi_read | 0.1 | 0.1–0.2 | 0.0% |
| papi_flush | 779.6 | 660.9–870.9 | 18.4% |
| off_boundary | 1124.6 | 958.4–1165 | 26.6% |

Host calls 600,126 (20 per row), 2 `__FlushElementTree`, start delay 21.3 ms. Wall 3575 ms control / 3687.9 ms counts / 4230.6 ms timed; overhead 1.032× counts, 1.183× timed.

### `octane-mts-program-profile` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.2 | 19.6–22.5 | 0.5% |
| papi_create | 1732.1 | 1621.6–1906 | 41.4% |
| papi_props | 161.6 | 154.9–202.4 | 3.9% |
| papi_events | 98.9 | 89.4–155.7 | 2.4% |
| papi_topology | 154 | 149.1–159.3 | 3.7% |
| papi_read | 0.2 | 0.1–0.2 | 0.0% |
| papi_flush | 800.9 | 707.3–884.2 | 19.1% |
| off_boundary | 1145.6 | 1072.5–1220.5 | 27.4% |

Host calls 600,126 (20 per row), 2 `__FlushElementTree`, start delay 21.9 ms. Wall 3793 ms control / 3683.3 ms counts / 4184.9 ms timed; overhead 0.971× counts, 1.103× timed.

### `octane-direct` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 3.4 | 3.1–3.5 | 0.1% |
| papi_create | 1670.1 | 1604.1–1766.9 | 54.5% |
| papi_props | 181.5 | 166.5–192.7 | 5.9% |
| papi_events | 83.8 | 82.6–88 | 2.7% |
| papi_topology | 150.3 | 142.1–157 | 4.9% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_flush | 559.4 | 549.6–657.5 | 18.3% |
| off_boundary | 440.1 | 421.2–674.4 | 14.4% |

Host calls 600,127 (20 per row), 2 `__FlushElementTree`, start delay 3.3 ms. Wall 2632.9 ms control / 2722.6 ms counts / 3063.8 ms timed; overhead 1.034× counts, 1.164× timed.

### `octane` first-screen phase split @30000 — what off-boundary time is Octane's

Measured on `octane-profile`, the profile build of `octane`. Its first-screen wall on the uninstrumented control pages is 4738.8 ms against that shipping cell's 4580.7 ms in the same window — +158.1 ms, +3.5%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 195.8 |
| publish | 720,152 | 3266.9 | 1404.1 |
| capture | 210,041 | 47.6 | 270.3 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 1864.9 |
| **residue — web-core script and the browser frame** | — | — | 272.7 |

Off-boundary in the profiled cell's own timed FCP window is 2137.6 ms, against 2012.2 ms in `octane`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### `octane-mts-program` first-screen phase split @30000 — what off-boundary time is Octane's

Measured on `octane-mts-program-profile`, the profile build of `octane-mts-program`. Its first-screen wall on the uninstrumented control pages is 3793 ms against that shipping cell's 3575 ms in the same window — +218 ms, +6.1%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 90 |
| publish | 600,124 | 3019.1 | 660.4 |
| capture | 0 | 0 | 25 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 796.5 |
| **residue — web-core script and the browser frame** | — | — | 339.1 |

Off-boundary in the profiled cell's own timed FCP window is 1145.6 ms, against 1124.6 ms in `octane-mts-program`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### Octane internal control — first-screen path vs create path @30000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 3653.8 ms on the control pages; its direct pre-populated FCP@30000 is 4580.7 ms — an excess of **926.9 ms (25.4%)** for the same rendered result. The counts build agrees: 3734.1 ms composed against 4876.1 ms direct.

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
| start_delay | 20.9 | 478.9 | -458 |
| papi_create | 2122.9 | 1955.6 | +167.3 |
| papi_props | 415.8 | 227.7 | +188.1 |
| papi_events | 121.2 | 109.6 | +11.6 |
| papi_topology | 217 | 559.4 | -342.4 |
| papi_read | 78.8 | 0 | +78.8 |
| papi_flush | 633.6 | 0.1 | +633.5 |
| off_boundary | 2012.2 | 833.1 | +1179.1 |

### Octane − `octane-mts-program`, create@30000

Certified wall-clock delta: 88.9 ms on the control pages, -24.3 ms on the counts build. The attribution below runs on the timed build, whose delta is -40.3 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | n/a | NO-GO | 600001 vs 600001 host calls at 0.0048 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -14.4 | n/a | NO-GO | 478.9 vs 493.3 ms to the first host call |
| Per-element creation stream shape | -31.1 | n/a | NO-GO | 0.0048 vs 0.0048 ms of host time per call |
| Framework script and browser paint outside the host boundary | -35.6 | n/a | NO-GO | 833.1 vs 868.7 ms off the host boundary |
| **median non-additivity** | 40.8 | 101.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: -3.4 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.6 | n/a | NO-GO | 195 vs 126 host calls at 0.0230 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 1 | n/a | NO-GO | 23.6 vs 22.6 ms to the first host call |
| Per-element creation stream shape | -0.9 | n/a | NO-GO | 0.0185 vs 0.0230 ms of host time per call |
| Framework script and browser paint outside the host boundary | -2.7 | n/a | NO-GO | 4.1 vs 6.8 ms off the host boundary |
| **median non-additivity** | 0.9 | 898.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, create@30000

Certified wall-clock delta: 817.1 ms on the control pages, 905.7 ms on the counts build. The attribution below runs on the timed build, whose delta is 943.1 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 600001 vs 600001 host calls at 0.0046 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 456.1 | 48.4% | GO | 478.9 vs 22.8 ms to the first host call |
| Per-element creation stream shape | 85.9 | 9.1% | NO-GO | 0.0048 vs 0.0046 ms of host time per call |
| Framework script and browser paint outside the host boundary | 358.5 | 38.0% | GO | 833.1 vs 474.6 ms off the host boundary |
| **median non-additivity** | 42.6 | 4.5% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, startup

Certified wall-clock delta: 18.8 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 2 | 9.8% | NO-GO | 195 vs 127 host calls at 0.0291 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.5% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 19.6 | 96.6% | GO | 23.6 vs 4.0 ms to the first host call |
| Per-element creation stream shape | -2.1 | -10.3% | NO-GO | 0.0185 vs 0.0291 ms of host time per call |
| Framework script and browser paint outside the host boundary | 0.1 | 0.5% | NO-GO | 4.1 vs 4.0 ms off the host boundary |
| **median non-additivity** | 0.6 | 3.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 30,000 projected | 1,000 direct | 10,000 direct | 30,000 direct |
|---|---:|---:|---:|---:|---:|---:|
| octane | 175.2 | 1326.6 | 3653.8 | 189.9 | 1582 | 4580.7 |
| octane-profile | 180.9 | 1362.4 | 3972.9 | 198.1 | 1589.3 | 4738.8 |
| octane-mts-program | 174.5 | 1344.7 | 3562.1 | 149.6 | 1175.1 | 3575 |
| octane-mts-program-profile | 187 | 1384.8 | 3902.1 | 159.4 | 1304.9 | 3793 |
| octane-direct | 114.1 | 998.2 | 2819.1 | 106.1 | 999.6 | 2632.9 |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | 30,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---:|---|
| octane | 20 | 20 | 20 | 0.0% | yes |
| octane-profile | 20 | 20 | 20 | 0.0% | yes |
| octane-mts-program | 20 | 20 | 20 | 0.0% | yes |
| octane-mts-program-profile | 20 | 20 | 20 | 0.0% | yes |
| octane-direct | 20 | 20 | 20 | 0.0% | yes |

