# Element PAPI boundary decomposition — Octane vs Octane (profile build) vs react-first-screen

- measured: 2026-08-31T01:19:29.762Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v22; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 1.03/0.75/1.00 (1/5/15m), end 1.77/1.50/1.27
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
| wall ms, control | 126.8 | 133.4 | 125.7 |
| wall ms, counts build | 134.4 | 143 | 131.7 |
| wall ms, timed build | 154.4 | 152.8 | 144.3 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 30.8 | 33.1 | 28.1 |
| host op time ms, timed | 91.2 | 87.2 | 91.3 |
| host ms per call, timed | 0.00456 | 0.00436 | 0.00435 |
| flush time ms, timed | 0.1 | 0 | 0 |
| off-boundary ms, timed | 28.1 | 32.5 | 23.3 |
| counts-build overhead | 1.06× | 1.072× | 1.048× |
| timed-build overhead | 1.218× | 1.145× | 1.148× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile | react-first-screen |
|---|---:|---:|---:|
| slice start → paint ms, control | 32 | 28.5 | 15.5 |
| slice start → paint ms, counts | 33.6 | 29.3 | 14.9 |
| start delay ms | 21.4 | 21.3 | 6.7 |
| host calls | 195 | 195 | 114 |
| `__FlushElementTree` calls | 2 | 2 | 1 |
| host op time ms, timed | 3.1 | 2.9 | 2.6 |
| off-boundary ms, timed | 9 | 3.9 | 2.9 |
| counts-build overhead | 1.05× | 1.028× | 0.961× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21.9 | 21.4–22.4 | 11.1% |
| papi_create | 59.3 | 58.4–65.6 | 30.0% |
| papi_props | 11.9 | 10–13 | 6.0% |
| papi_events | 6.7 | 5.8–7.7 | 3.4% |
| papi_topology | 8 | 5.9–10.2 | 4.0% |
| papi_read | 2.9 | 2.6–4.2 | 1.5% |
| papi_flush | 15.7 | 11.2–18 | 7.9% |
| off_boundary | 69.3 | 68–73.8 | 35.0% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 21.6 ms. Wall 171 ms control / 179.6 ms counts / 197.9 ms timed; overhead 1.05× counts, 1.157× timed.

### `octane-profile` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21.6 | 21.1–22.9 | 11.0% |
| papi_create | 62.5 | 55–67.5 | 31.8% |
| papi_props | 9.9 | 9.5–10.5 | 5.0% |
| papi_events | 5.9 | 5.6–6.6 | 3.0% |
| papi_topology | 6.2 | 5.6–7.1 | 3.2% |
| papi_read | 2.6 | 1.8–3.4 | 1.3% |
| papi_flush | 11.3 | 11.1–14.9 | 5.7% |
| off_boundary | 79.7 | 72.6–85.2 | 40.5% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 21.6 ms. Wall 180.8 ms control / 180.7 ms counts / 196.6 ms timed; overhead 0.999× counts, 1.087× timed.

### `react-first-screen` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 7.4 | 7–11.9 | 5.8% |
| papi_create | 50.2 | 46.9–55.4 | 39.1% |
| papi_props | 16.7 | 16.6–19.3 | 13.0% |
| papi_events | 5.9 | 4.3–6.4 | 4.6% |
| papi_topology | 5.2 | 4.6–6.8 | 4.0% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_other | 0.2 | 0.1–0.3 | 0.2% |
| papi_flush | 12.5 | 11.6–15.1 | 9.7% |
| off_boundary | 28.3 | 26.8–33.3 | 22.0% |

Host calls 21,114 (21.11 per row), 1 `__FlushElementTree`, start delay 7.3 ms. Wall 107.8 ms control / 118 ms counts / 128.4 ms timed; overhead 1.095× counts, 1.191× timed.

### `octane` first-screen phase split @1000 — what off-boundary time is Octane's

Measured on `octane-profile`, the profile build of `octane`. Its first-screen wall on the uninstrumented control pages is 180.8 ms against that shipping cell's 171 ms in the same window — +9.8 ms, +5.7%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 17.8 |
| publish | 24,152 | 96.9 | 43.5 |
| capture | 7,041 | 2.5 | 5.7 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 68.5 |
| **residue — web-core script and the browser frame** | — | — | 11.5 |

Off-boundary in the profiled cell's own timed FCP window is 79.7 ms, against 69.3 ms in `octane`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

Against `react-first-screen`, whose whole bucket 4 is 28.3 ms and has no parts to compare a part against: Octane's first-screen script alone exceeds it by 40.2 ms. That subtracts nothing on the reference side, so it holds however the reference's own remainder divides internally.

| share | denominator | value |
|---|---|---:|
| framework ÷ Octane's own bucket 4 | `octane-profile` off-boundary, 79.7 ms | 85.9% |
| framework excess ÷ the FCP gap | `octane` FCP wall − `react-first-screen` FCP wall, 69.5 ms | 57.8% |

Only the second is a claim about the gap; the first is a composition statement about one cell and says nothing about the reference. See `docs/measurement/fcp-attribution.md` for which of the two a verdict may rest on, and for the two-window spread of each.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 158.8 ms on the control pages; its direct pre-populated FCP@1000 is 171 ms — an excess of **12.2 ms (7.7%)** for the same rendered result. The counts build agrees: 168 ms composed against 179.6 ms direct.

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
| start_delay | 21.9 | 30.2 | -8.3 |
| papi_create | 59.3 | 60.3 | -1 |
| papi_props | 11.9 | 7.8 | +4.1 |
| papi_events | 6.7 | 5.6 | +1.1 |
| papi_topology | 8 | 17.5 | -9.5 |
| papi_read | 2.9 | 0 | +2.9 |
| papi_flush | 15.7 | 0.1 | +15.6 |
| off_boundary | 69.3 | 28.1 | +41.2 |

### Octane − `react-first-screen`, create@1000

Certified wall-clock delta: 1.1 ms on the control pages, 2.7 ms on the counts build. The attribution below runs on the timed build, whose delta is 10.1 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -4.3 | -43.0% | NO-GO | 20001 vs 21001 host calls at 0.0043 ms/op (reference rate) |
| Flush cadence | 0.1 | 1.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 1.3 | 12.9% | GO | 30.2 vs 28.9 ms to the first host call |
| Per-element creation stream shape | 4.2 | 42.1% | GO | 0.0046 vs 0.0043 ms of host time per call |
| Framework script and browser paint outside the host boundary | 4.8 | 47.5% | GO | 28.1 vs 23.3 ms off the host boundary |
| **median non-additivity** | 4 | 39.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, startup

Certified wall-clock delta: 18.7 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.8 | 11.5% | GO | 195 vs 114 host calls at 0.0228 ms/op (reference rate) |
| Flush cadence | 0.2 | 1.2% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 14.4 | 89.4% | GO | 21.4 vs 7.0 ms to the first host call |
| Per-element creation stream shape | -1.3 | -8.4% | NO-GO | 0.0159 vs 0.0228 ms of host time per call |
| Framework script and browser paint outside the host boundary | 6.1 | 37.9% | GO | 9.0 vs 2.9 ms off the host boundary |
| **median non-additivity** | -5.1 | 31.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, FCP@1000

Certified wall-clock delta: 63.2 ms on the control pages, 61.6 ms on the counts build. The attribution below runs on the timed build, whose delta is 69.5 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 37.3 | 53.7% | GO | 31195 vs 21114 host calls at 0.0037 ms/op (reference rate) |
| Flush cadence | 3.2 | 4.6% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 14.5 | 20.9% | GO | 21.9 vs 7.4 ms to the first host call |
| Per-element creation stream shape | -26.7 | -38.5% | NO-GO | 0.0028 vs 0.0037 ms of host time per call |
| Framework script and browser paint outside the host boundary | 41 | 59.0% | GO | 69.3 vs 28.3 ms off the host boundary |
| **median non-additivity** | 0.2 | 0.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

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
| wall ms, control | 1065.4 | 1129.5 | 1038.4 |
| wall ms, counts build | 1131 | 1116.5 | 1107.3 |
| wall ms, timed build | 1228.4 | 1210.1 | 1240.4 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 165.5 | 156.9 | 209.1 |
| host op time ms, timed | 807.3 | 775.3 | 794.7 |
| host ms per call, timed | 0.00404 | 0.00388 | 0.00378 |
| flush time ms, timed | 0 | 0 | 0.1 |
| off-boundary ms, timed | 250.7 | 295.3 | 218.9 |
| counts-build overhead | 1.062× | 0.988× | 1.066× |
| timed-build overhead | 1.153× | 1.071× | 1.195× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile | react-first-screen |
|---|---:|---:|---:|
| slice start → paint ms, control | 29.5 | 35.8 | 14.7 |
| slice start → paint ms, counts | 29.4 | 34.2 | 14.5 |
| start delay ms | 21.3 | 22.4 | 6.9 |
| host calls | 195 | 195 | 114 |
| `__FlushElementTree` calls | 2 | 2 | 1 |
| host op time ms, timed | 2.8 | 3.2 | 2.7 |
| off-boundary ms, timed | 3 | 5.6 | 3 |
| counts-build overhead | 0.997× | 0.955× | 0.986× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.8 | 20.2–25.7 | 1.4% |
| papi_create | 541.8 | 490.8–566.7 | 36.5% |
| papi_props | 107.8 | 97.2–112 | 7.3% |
| papi_events | 37.8 | 35.7–38.9 | 2.5% |
| papi_topology | 72.2 | 65.7–76.4 | 4.9% |
| papi_read | 27.5 | 24.7–29.5 | 1.9% |
| papi_flush | 143.6 | 131.3–149.5 | 9.7% |
| off_boundary | 543.8 | 529.4–608.4 | 36.6% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 21.3 ms. Wall 1213.6 ms control / 1357.5 ms counts / 1485.9 ms timed; overhead 1.119× counts, 1.224× timed.

### `octane-profile` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 22.3 | 20.4–23.4 | 1.5% |
| papi_create | 511.4 | 484.9–545.3 | 34.5% |
| papi_props | 90.6 | 87.6–95.7 | 6.1% |
| papi_events | 38.9 | 33.1–55.6 | 2.6% |
| papi_topology | 59.1 | 56.6–61.2 | 4.0% |
| papi_read | 18.1 | 15.8–19.5 | 1.2% |
| papi_flush | 142.8 | 115.7–146.6 | 9.6% |
| off_boundary | 594.5 | 553.4–617.1 | 40.1% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 20.9 ms. Wall 1273.4 ms control / 1368.1 ms counts / 1483.4 ms timed; overhead 1.074× counts, 1.165× timed.

### `react-first-screen` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 11.1 | 10.5–12.2 | 1.1% |
| papi_create | 413.4 | 397–418.9 | 39.9% |
| papi_props | 145.7 | 135.9–157.3 | 14.1% |
| papi_events | 28.6 | 25.3–30.8 | 2.8% |
| papi_topology | 45.9 | 43.8–47.5 | 4.4% |
| papi_read | 0 | 0–0 | 0.0% |
| papi_other | 1.1 | 1–1.1 | 0.1% |
| papi_flush | 156.2 | 154.3–168 | 15.1% |
| off_boundary | 237.9 | 232.1–240.3 | 23.0% |

Host calls 210,114 (21.01 per row), 1 `__FlushElementTree`, start delay 11.7 ms. Wall 886.2 ms control / 944.8 ms counts / 1036.2 ms timed; overhead 1.066× counts, 1.169× timed.

### `octane` first-screen phase split @10000 — what off-boundary time is Octane's

Measured on `octane-profile`, the profile build of `octane`. Its first-screen wall on the uninstrumented control pages is 1273.4 ms against that shipping cell's 1213.6 ms in the same window — +59.8 ms, +4.9%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 85.7 |
| publish | 240,152 | 847 | 349.6 |
| capture | 70,041 | 18 | 50.9 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 516.3 |
| **residue — web-core script and the browser frame** | — | — | 92.7 |

Off-boundary in the profiled cell's own timed FCP window is 594.5 ms, against 543.8 ms in `octane`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

Against `react-first-screen`, whose whole bucket 4 is 237.9 ms and has no parts to compare a part against: Octane's first-screen script alone exceeds it by 278.4 ms. That subtracts nothing on the reference side, so it holds however the reference's own remainder divides internally.

| share | denominator | value |
|---|---|---:|
| framework ÷ Octane's own bucket 4 | `octane-profile` off-boundary, 594.5 ms | 86.8% |
| framework excess ÷ the FCP gap | `octane` FCP wall − `react-first-screen` FCP wall, 449.7 ms | 61.9% |

Only the second is a claim about the gap; the first is a composition statement about one cell and says nothing about the reference. See `docs/measurement/fcp-attribution.md` for which of the two a verdict may rest on, and for the two-window spread of each.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1094.9 ms on the control pages; its direct pre-populated FCP@10000 is 1213.6 ms — an excess of **118.7 ms (10.8%)** for the same rendered result. The counts build agrees: 1160.4 ms composed against 1357.5 ms direct.

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
| start_delay | 20.8 | 160.2 | -139.4 |
| papi_create | 541.8 | 537.1 | +4.7 |
| papi_props | 107.8 | 70.3 | +37.5 |
| papi_events | 37.8 | 34 | +3.8 |
| papi_topology | 72.2 | 165.9 | -93.7 |
| papi_read | 27.5 | 0 | +27.5 |
| papi_flush | 143.6 | 0 | +143.6 |
| off_boundary | 543.8 | 250.7 | +293.1 |

### Octane − `react-first-screen`, create@10000

Certified wall-clock delta: 27 ms on the control pages, 23.7 ms on the counts build. The attribution below runs on the timed build, whose delta is -12 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -37.8 | n/a | NO-GO | 200001 vs 210001 host calls at 0.0038 ms/op (reference rate) |
| Flush cadence | -0.1 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -45.9 | n/a | NO-GO | 160.2 vs 206.1 ms to the first host call |
| Per-element creation stream shape | 50.4 | n/a | NO-GO | 0.0040 vs 0.0038 ms of host time per call |
| Framework script and browser paint outside the host boundary | 31.8 | n/a | NO-GO | 250.7 vs 218.9 ms off the host boundary |
| **median non-additivity** | -10.4 | 86.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, startup

Certified wall-clock delta: 14.9 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.9 | 14.9% | GO | 195 vs 114 host calls at 0.0237 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.8% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 14.2 | 110.1% | GO | 21.1 vs 6.9 ms to the first host call |
| Per-element creation stream shape | -1.8 | -14.1% | NO-GO | 0.0144 vs 0.0237 ms of host time per call |
| Framework script and browser paint outside the host boundary | 0 | -0.0% | NO-GO | 3.0 vs 3.0 ms off the host boundary |
| **median non-additivity** | -1.5 | 11.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, FCP@10000

Certified wall-clock delta: 327.4 ms on the control pages, 412.7 ms on the counts build. The attribution below runs on the timed build, whose delta is 449.7 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 302.3 | 67.2% | GO | 310195 vs 210114 host calls at 0.0030 ms/op (reference rate) |
| Flush cadence | -12.6 | -2.8% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 9.7 | 2.2% | NO-GO | 20.8 vs 11.1 ms to the first host call |
| Per-element creation stream shape | -149.9 | -33.3% | NO-GO | 0.0025 vs 0.0030 ms of host time per call |
| Framework script and browser paint outside the host boundary | 305.9 | 68.0% | GO | 543.8 vs 237.9 ms off the host boundary |
| **median non-additivity** | -5.7 | 1.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 1,000 direct | 10,000 direct |
|---|---:|---:|---:|---:|
| octane | 158.8 | 1094.9 | 171 | 1213.6 |
| octane-profile | 161.9 | 1165.3 | 180.8 | 1273.4 |
| react-first-screen | 141.2 | 1053.1 | 107.8 | 886.2 |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---|
| octane | 20 | 20 | 0.0% | yes |
| octane-profile | 20 | 20 | 0.0% | yes |
| react-first-screen | 21 | 21 | 0.0% | yes |

